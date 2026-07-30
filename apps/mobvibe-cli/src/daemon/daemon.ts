import { Database } from "bun:sqlite";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { base64ToUint8, initCrypto } from "@mobvibe/shared";
import { SessionManager } from "../acp/session-manager.js";
import { getMasterSecret } from "../auth/credentials.js";
import type { CliConfig } from "../config.js";
import { CliCryptoService } from "../e2ee/crypto-service.js";
import { logger } from "../lib/logger.js";
import { WalCompactor, WalStore } from "../wal/index.js";
import { SocketClient } from "./socket-client.js";
import { buildBackgroundSpawnArgs } from "./spawn-utils.js";

type DaemonStatus = {
	running: boolean;
	pid?: number;
	connected?: boolean;
	sessionCount?: number;
};

const COMPACTION_SHUTDOWN_TIMEOUT_MS = 4_000;
const DAEMON_IDENTITY_FILE_PREFIX = ".mobvibe-daemon-";
const DAEMON_IDENTITY_FILE_SUFFIX = ".identity";
const PID_FILE_LOCK_RETRY_COUNT = 100;
const PID_FILE_LOCK_RETRY_MS = 20;
const PID_FILE_LOCK_OWNER_FILE = "owner.json";
const MOBVIBE_CLI_PACKAGE_NAME = "@mobvibe/cli";

type SupportedDaemonPlatform = "darwin" | "linux" | "win32";

export type DaemonProcessIdentity = {
	platform: SupportedDaemonPlatform;
	uid: number | string;
	startTime: string;
	instanceId: string | null;
	commandLine?: string[];
	cwd?: string;
	cwdPackageName?: string;
};

export type DaemonPidRecord = {
	version: 1;
	pid: number;
	instanceId: string;
	process: Omit<DaemonProcessIdentity, "instanceId">;
};

type DaemonPidState =
	| { kind: "record"; content: string; record: DaemonPidRecord }
	| { kind: "legacy"; content: string; pid: number };

type DaemonIdentityState = "matches" | "missing" | "mismatch" | "unverifiable";

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
	error instanceof Error && "code" in error;

export type DaemonProcessControl = {
	kill: (pid: number, signal: NodeJS.Signals | 0) => void;
	inspectProcess: (pid: number) => Promise<DaemonProcessIdentity | null>;
	currentUid: () => number | string | null | Promise<number | string | null>;
	now: () => number;
	wait: (milliseconds: number) => Promise<void>;
};

const daemonIdentityFileName = (instanceId: string): string =>
	`${DAEMON_IDENTITY_FILE_PREFIX}${instanceId}${DAEMON_IDENTITY_FILE_SUFFIX}`;

const daemonIdentityFilePath = (pidFile: string, instanceId: string): string =>
	path.join(path.dirname(pidFile), daemonIdentityFileName(instanceId));

const parseQuotedCommandLine = (commandLine: string): string[] => {
	const args: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	for (const character of commandLine.trim()) {
		if (character === '"' || character === "'") {
			if (quote === character) {
				quote = undefined;
			} else if (!quote) {
				quote = character;
			} else {
				current += character;
			}
			continue;
		}
		if (/\s/.test(character) && !quote) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += character;
	}
	if (current) args.push(current);
	return args;
};

const isAllowedLegacyRuntimeFlag = (
	runtimeName: string,
	argument: string,
): boolean => {
	if (runtimeName === "bun" || runtimeName === "bun.exe") {
		return (
			argument === "--watch" ||
			argument === "--hot" ||
			argument === "--no-clear-screen"
		);
	}
	if (runtimeName === "node" || runtimeName === "node.exe") {
		return (
			argument === "--watch" ||
			argument === "--watch-preserve-output" ||
			/^--watch-(?:kill-signal|path)=.+$/.test(argument)
		);
	}
	return false;
};

const getLegacyMobvibeCommandState = (
	identity: DaemonProcessIdentity,
): Exclude<DaemonIdentityState, "missing"> => {
	const args = identity.commandLine;
	if (!args || args.length === 0) return "mismatch";
	const normalizedArgs = args.map((argument) => argument.toLowerCase());
	const startIndex = normalizedArgs.indexOf("start");
	if (startIndex < 1) return "mismatch";
	const daemonArguments = normalizedArgs.slice(startIndex + 1);
	if (
		!daemonArguments.includes("--foreground") &&
		!daemonArguments.includes("-f")
	) {
		return "mismatch";
	}
	const commandPrefix = normalizedArgs.slice(0, startIndex);
	const executablePath = commandPrefix[0]?.replace(/\\/g, "/");
	if (!executablePath) return "mismatch";
	if (commandPrefix.length === 1) {
		return /^mobvibe(?:\.exe)?$/.test(path.posix.basename(executablePath))
			? "matches"
			: "mismatch";
	}
	const runtimeName = path.posix.basename(executablePath);
	if (!/^(?:bun|node)(?:\.exe)?$/.test(runtimeName)) {
		return "mismatch";
	}
	let entrypointIndex = 1;
	while (
		entrypointIndex < commandPrefix.length &&
		commandPrefix[entrypointIndex]?.startsWith("-")
	) {
		const runtimeFlag = commandPrefix[entrypointIndex];
		if (!runtimeFlag || !isAllowedLegacyRuntimeFlag(runtimeName, runtimeFlag)) {
			return "mismatch";
		}
		entrypointIndex += 1;
	}
	if (entrypointIndex !== commandPrefix.length - 1) return "mismatch";

	const entrypointPath = commandPrefix[entrypointIndex]?.replace(/\\/g, "/");
	if (!entrypointPath) return "mismatch";
	if (
		entrypointPath.includes("/apps/mobvibe-cli/") ||
		entrypointPath.includes("/node_modules/@mobvibe/cli/")
	) {
		return "matches";
	}
	const relativeEntrypoint = entrypointPath.replace(/^\.\//, "");
	const isRelativeDevelopmentEntrypoint =
		relativeEntrypoint === "dist/index.js" ||
		relativeEntrypoint === "src/index.ts";
	if (!isRelativeDevelopmentEntrypoint) return "mismatch";
	if (
		identity.cwdPackageName !== undefined &&
		identity.cwdPackageName !== MOBVIBE_CLI_PACKAGE_NAME
	) {
		return "mismatch";
	}
	if (!identity.cwd || identity.cwdPackageName === undefined) {
		return "unverifiable";
	}
	return "matches";
};

const readCwdPackageName = async (cwd: string): Promise<string | undefined> => {
	let content: string;
	try {
		content = await fs.readFile(path.join(cwd, "package.json"), "utf8");
	} catch (error) {
		if (
			isNodeError(error) &&
			(error.code === "ENOENT" ||
				error.code === "ENOTDIR" ||
				error.code === "EACCES")
		) {
			return undefined;
		}
		throw error;
	}
	try {
		const parsed = JSON.parse(content) as unknown;
		if (!parsed || typeof parsed !== "object") return undefined;
		const name = (parsed as Record<string, unknown>).name;
		return typeof name === "string" ? name : undefined;
	} catch {
		return undefined;
	}
};

const extractDaemonInstanceId = (
	openFiles: readonly string[],
): string | null => {
	const instanceIds = new Set<string>();
	for (const openFile of openFiles) {
		const fileName = path.basename(openFile.replace(/ \(deleted\)$/, ""));
		const match = fileName.match(/^\.mobvibe-daemon-([a-f0-9]{16})\.identity$/);
		if (match?.[1]) instanceIds.add(match[1]);
	}
	if (instanceIds.size > 1) {
		throw new Error("Daemon process has multiple open identity files");
	}
	return instanceIds.values().next().value ?? null;
};

const readLinuxOpenFiles = async (pid: number): Promise<string[]> => {
	const fileDescriptorDirectory = `/proc/${pid}/fd`;
	let fileDescriptors: string[];
	try {
		fileDescriptors = await fs.readdir(fileDescriptorDirectory);
	} catch (error) {
		if (
			isNodeError(error) &&
			(error.code === "ENOENT" || error.code === "ESRCH")
		) {
			return [];
		}
		throw error;
	}
	const openFiles = await Promise.all(
		fileDescriptors.map(async (fileDescriptor) => {
			try {
				return await fs.readlink(
					path.join(fileDescriptorDirectory, fileDescriptor),
				);
			} catch (error) {
				if (isNodeError(error) && error.code === "ENOENT") return null;
				throw error;
			}
		}),
	);
	return openFiles.filter((openFile): openFile is string => openFile !== null);
};

const inspectLinuxProcess = async (
	pid: number,
): Promise<DaemonProcessIdentity | null> => {
	try {
		const processDirectory = `/proc/${pid}`;
		const [statContent, processStat, openFiles, commandLineContent, cwd] =
			await Promise.all([
				fs.readFile(path.join(processDirectory, "stat"), "utf8"),
				fs.stat(processDirectory),
				readLinuxOpenFiles(pid),
				fs.readFile(path.join(processDirectory, "cmdline"), "utf8"),
				fs.readlink(path.join(processDirectory, "cwd")),
			]);
		const commandEnd = statContent.lastIndexOf(")");
		if (commandEnd < 0) {
			throw new Error(`Unable to parse process identity for PID ${pid}`);
		}
		const fieldsAfterCommand = statContent
			.slice(commandEnd + 1)
			.trim()
			.split(/\s+/);
		const startTime = fieldsAfterCommand[19];
		if (!startTime) {
			throw new Error(`Unable to parse process start time for PID ${pid}`);
		}
		return {
			platform: "linux",
			uid: processStat.uid,
			startTime,
			instanceId: extractDaemonInstanceId(openFiles),
			commandLine: commandLineContent.split("\0").filter(Boolean),
			cwd,
			cwdPackageName: await readCwdPackageName(cwd),
		};
	} catch (error) {
		if (
			isNodeError(error) &&
			(error.code === "ENOENT" || error.code === "ESRCH")
		) {
			return null;
		}
		throw error;
	}
};

const runPs = async (pid: number): Promise<string | null> =>
	new Promise((resolve, reject) => {
		execFile(
			"ps",
			["-p", String(pid), "-o", "uid=", "-o", "lstart="],
			{ encoding: "utf8", env: { ...process.env, LC_ALL: "C" } },
			(error, stdout) => {
				if (error) {
					const exitCode = (error as Error & { code?: string | number }).code;
					if (exitCode === 1 || exitCode === "1") {
						resolve(null);
						return;
					}
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});

const runLsof = async (pid: number): Promise<string[] | null> =>
	new Promise((resolve, reject) => {
		execFile(
			"/usr/sbin/lsof",
			["-a", "-p", String(pid), "-Fn"],
			{ encoding: "utf8", env: { ...process.env, LC_ALL: "C" } },
			(error, stdout) => {
				if (error) {
					const exitCode = (error as Error & { code?: string | number }).code;
					if (exitCode === 1 || exitCode === "1") {
						resolve(null);
						return;
					}
					reject(error);
					return;
				}
				resolve(
					stdout
						.split("\n")
						.filter((line) => line.startsWith("n"))
						.map((line) => line.slice(1)),
				);
			},
		);
	});

const runPsCommand = async (pid: number): Promise<string | null> =>
	new Promise((resolve, reject) => {
		execFile(
			"ps",
			["-p", String(pid), "-o", "command="],
			{ encoding: "utf8", env: { ...process.env, LC_ALL: "C" } },
			(error, stdout) => {
				if (error) {
					const exitCode = (error as Error & { code?: string | number }).code;
					if (exitCode === 1 || exitCode === "1") {
						resolve(null);
						return;
					}
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});

const runLsofCwd = async (pid: number): Promise<string | null> =>
	new Promise((resolve, reject) => {
		execFile(
			"/usr/sbin/lsof",
			["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
			{ encoding: "utf8", env: { ...process.env, LC_ALL: "C" } },
			(error, stdout) => {
				if (error) {
					const exitCode = (error as Error & { code?: string | number }).code;
					if (exitCode === 1 || exitCode === "1") {
						resolve(null);
						return;
					}
					reject(error);
					return;
				}
				resolve(
					stdout
						.split("\n")
						.find((line) => line.startsWith("n"))
						?.slice(1) ?? null,
				);
			},
		);
	});

export type DarwinProcessInspection = {
	runPs: (pid: number) => Promise<string | null>;
	runLsof: (pid: number) => Promise<string[] | null>;
	runCommand?: (pid: number) => Promise<string | null>;
	runCwd?: (pid: number) => Promise<string | null>;
};

export const inspectDarwinProcess = async (
	pid: number,
	inspection: DarwinProcessInspection = {
		runPs,
		runLsof,
		runCommand: runPsCommand,
		runCwd: runLsofCwd,
	},
): Promise<DaemonProcessIdentity | null> => {
	const output = await inspection.runPs(pid);
	if (output === null || output.trim() === "") return null;
	const openFiles = await inspection.runLsof(pid);
	if (openFiles === null) {
		throw new Error(`Unable to inspect open files for daemon process ${pid}`);
	}
	const command = inspection.runCommand
		? await inspection.runCommand(pid)
		: undefined;
	const cwd = inspection.runCwd ? await inspection.runCwd(pid) : undefined;
	const match = output
		.trim()
		.match(
			/^(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})$/,
		);
	if (!match) {
		throw new Error(`Unable to parse process identity for PID ${pid}`);
	}
	const uid = Number(match[1]);
	if (!Number.isSafeInteger(uid) || uid < 0) {
		throw new Error(`Unable to parse process owner for PID ${pid}`);
	}
	return {
		platform: "darwin",
		uid,
		startTime: match[2],
		instanceId: extractDaemonInstanceId(openFiles),
		commandLine: command ? parseQuotedCommandLine(command) : undefined,
		cwd: cwd ?? undefined,
		cwdPackageName: cwd ? await readCwdPackageName(cwd) : undefined,
	};
};

const runPowerShellProcessQuery = async (pid: number): Promise<string | null> =>
	new Promise((resolve, reject) => {
		const script = `
			[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
			$process = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'
			if ($null -eq $process) { exit 3 }
			$owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
			if ($owner.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($owner.Sid)) { exit 4 }
			[PSCustomObject]@{
				ownerSid = $owner.Sid
				startTime = $process.CreationDate.ToUniversalTime().ToString('O')
				commandLine = $process.CommandLine
			} | ConvertTo-Json -Compress
		`;
		execFile(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{ encoding: "utf8" },
			(error, stdout) => {
				if (error) {
					const exitCode = (error as Error & { code?: string | number }).code;
					if (exitCode === 3 || exitCode === "3") {
						resolve(null);
						return;
					}
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});

export type WindowsProcessInspection = {
	runPowerShell: (pid: number) => Promise<string | null>;
};

export const inspectWindowsProcess = async (
	pid: number,
	inspection: WindowsProcessInspection = {
		runPowerShell: runPowerShellProcessQuery,
	},
): Promise<DaemonProcessIdentity | null> => {
	const output = await inspection.runPowerShell(pid);
	if (output === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.trim());
	} catch {
		throw new Error(`Unable to parse process identity for PID ${pid}`);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Unable to parse process identity for PID ${pid}`);
	}
	const record = parsed as Record<string, unknown>;
	if (
		typeof record.ownerSid !== "string" ||
		!/^S-\d+(?:-\d+)+$/i.test(record.ownerSid.trim()) ||
		typeof record.startTime !== "string" ||
		!record.startTime.trim() ||
		(record.commandLine !== null &&
			record.commandLine !== undefined &&
			typeof record.commandLine !== "string")
	) {
		throw new Error(`Unable to parse process identity for PID ${pid}`);
	}
	return {
		platform: "win32",
		uid: record.ownerSid.trim().toUpperCase(),
		startTime: record.startTime.trim(),
		instanceId: null,
		commandLine:
			typeof record.commandLine === "string"
				? parseQuotedCommandLine(record.commandLine)
				: undefined,
	};
};

const runPowerShellCurrentUserSid = async (): Promise<string> =>
	new Promise((resolve, reject) => {
		const script = `
			[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
			$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
			if ([string]::IsNullOrWhiteSpace($sid)) { exit 4 }
			$sid
		`;
		execFile(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{ encoding: "utf8" },
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				const sid = stdout.trim().toUpperCase();
				if (!/^S-\d+(?:-\d+)+$/.test(sid)) {
					reject(new Error("Unable to determine the current Windows user SID"));
					return;
				}
				resolve(sid);
			},
		);
	});

let currentWindowsSidPromise: Promise<string> | undefined;

const getCurrentWindowsSid = (): Promise<string> => {
	if (!currentWindowsSidPromise) {
		currentWindowsSidPromise = runPowerShellCurrentUserSid().catch((error) => {
			currentWindowsSidPromise = undefined;
			throw error;
		});
	}
	return currentWindowsSidPromise;
};

const inspectDaemonProcess = async (
	pid: number,
): Promise<DaemonProcessIdentity | null> => {
	if (process.platform === "linux") return inspectLinuxProcess(pid);
	if (process.platform === "darwin") return inspectDarwinProcess(pid);
	if (process.platform === "win32") return inspectWindowsProcess(pid);
	throw new Error(
		`Daemon process identity verification is unsupported on ${process.platform}`,
	);
};

const daemonProcessControl: DaemonProcessControl = {
	kill: (pid, signal) => {
		process.kill(pid, signal);
	},
	inspectProcess: inspectDaemonProcess,
	currentUid: () =>
		process.platform === "win32"
			? getCurrentWindowsSid()
			: (process.getuid?.() ?? null),
	now: Date.now,
	wait: (milliseconds) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

const delay = async (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

type PidFileLockRecord = {
	version: 1;
	pid: number;
	nonce: string;
	process: {
		platform: SupportedDaemonPlatform;
		uid: number | string;
		startTime: string;
	};
};

type PidFileLockState = {
	content: string;
	record: PidFileLockRecord;
};

const isPidFileLockRecord = (value: unknown): value is PidFileLockRecord => {
	if (!value || typeof value !== "object") return false;
	const record = value as Partial<PidFileLockRecord>;
	const processIdentity = record.process as
		| Partial<PidFileLockRecord["process"]>
		| undefined;
	return (
		record.version === 1 &&
		typeof record.pid === "number" &&
		Number.isSafeInteger(record.pid) &&
		record.pid > 0 &&
		typeof record.nonce === "string" &&
		/^[a-f0-9]{16}$/.test(record.nonce) &&
		processIdentity !== undefined &&
		(processIdentity.platform === "linux" ||
			processIdentity.platform === "darwin" ||
			processIdentity.platform === "win32") &&
		(typeof processIdentity.uid === "number" ||
			typeof processIdentity.uid === "string") &&
		typeof processIdentity.startTime === "string" &&
		processIdentity.startTime.length > 0 &&
		processIdentity.startTime.length <= 256
	);
};

const readPidFileLockState = async (
	lockDirectory: string,
): Promise<PidFileLockState | null> => {
	let content: string;
	try {
		content = await fs.readFile(
			path.join(lockDirectory, PID_FILE_LOCK_OWNER_FILE),
			"utf8",
		);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return null;
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}
	return isPidFileLockRecord(parsed) ? { content, record: parsed } : null;
};

type InspectPidFileLockProcess = (
	pid: number,
) => Promise<DaemonProcessIdentity | null>;

let currentPidFileLockIdentityPromise:
	| Promise<DaemonProcessIdentity | null>
	| undefined;

const getCurrentPidFileLockIdentity = () => {
	if (!currentPidFileLockIdentityPromise) {
		currentPidFileLockIdentityPromise = inspectDaemonProcess(process.pid).catch(
			(error) => {
				currentPidFileLockIdentityPromise = undefined;
				throw error;
			},
		);
	}
	return currentPidFileLockIdentityPromise;
};

const isPidFileLockOwnerActive = async (
	record: PidFileLockRecord,
	inspectProcess: InspectPidFileLockProcess,
): Promise<boolean> => {
	const identity = await inspectProcess(record.pid);
	return (
		identity !== null &&
		identity.platform === record.process.platform &&
		identity.uid === record.process.uid &&
		identity.startTime === record.process.startTime
	);
};

const pathExists = async (targetPath: string): Promise<boolean> => {
	try {
		await fs.access(targetPath);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return false;
		throw error;
	}
};

const throwIfPidFileLockHasNoVerifiableOwner = async (
	lockDirectory: string,
): Promise<void> => {
	if (await readPidFileLockState(lockDirectory)) return;

	// Legacy writers published an empty lock directory, while current lock and
	// recovery claims are atomically published with an owner. Without a valid
	// owner identity, no writer can be fenced from a later claim, so recovery
	// must be manual rather than based on mtime.
	let entries: string[];
	try {
		entries = await fs.readdir(lockDirectory);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return;
		throw error;
	}
	const reason = entries.includes(PID_FILE_LOCK_OWNER_FILE)
		? "its owner record is invalid"
		: "it has no owner record";
	throw new Error(
		`Daemon PID lock cannot be safely recovered because ${reason}: ${lockDirectory}. Verify that no Mobvibe CLI process is accessing the PID file, then remove this lock directory and retry.`,
	);
};

type PreparedPidFileLockClaim = {
	candidateDirectory: string;
	content: string;
};

const preparePidFileLockClaim = async (
	claimDirectory: string,
	identity: DaemonProcessIdentity,
): Promise<PreparedPidFileLockClaim> => {
	const nonce = randomBytes(8).toString("hex");
	const content = JSON.stringify({
		version: 1,
		pid: process.pid,
		nonce,
		process: {
			platform: identity.platform,
			uid: identity.uid,
			startTime: identity.startTime,
		},
	} satisfies PidFileLockRecord);
	const candidateDirectory = `${claimDirectory}.candidate.${process.pid}.${nonce}`;
	await fs.mkdir(candidateDirectory);
	try {
		await fs.writeFile(
			path.join(candidateDirectory, PID_FILE_LOCK_OWNER_FILE),
			content,
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
	} catch (error) {
		await fs.rm(candidateDirectory, { recursive: true, force: true });
		throw error;
	}
	return { candidateDirectory, content };
};

const releasePidFileLockClaim = async (
	claimDirectory: string,
	expectedContent: string,
): Promise<void> => {
	const current = await readPidFileLockState(claimDirectory);
	if (current?.content === expectedContent) {
		await fs.rm(claimDirectory, { recursive: true });
	}
};

const removeAbandonedPidFileLockClaim = async (
	claimDirectory: string,
	inspectProcess: InspectPidFileLockProcess,
): Promise<boolean> => {
	const observed = await readPidFileLockState(claimDirectory);
	if (
		!observed ||
		(await isPidFileLockOwnerActive(observed.record, inspectProcess))
	) {
		return false;
	}
	const abandonedDirectory = `${claimDirectory}.abandoned.${process.pid}.${randomBytes(8).toString("hex")}`;
	try {
		await fs.rename(claimDirectory, abandonedDirectory);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return true;
		throw error;
	}
	const moved = await readPidFileLockState(abandonedDirectory);
	if (!moved || moved.content !== observed.content) {
		await fs.rename(abandonedDirectory, claimDirectory).catch(() => undefined);
		return false;
	}
	await fs.rm(abandonedDirectory, { recursive: true, force: true });
	return true;
};

const recoverAbandonedPidFileLock = async (
	lockDirectory: string,
	inspectProcess: InspectPidFileLockProcess,
): Promise<boolean> => {
	const observed = await readPidFileLockState(lockDirectory);
	if (
		!observed ||
		(await isPidFileLockOwnerActive(observed.record, inspectProcess))
	) {
		return false;
	}

	const recoveryDirectory = `${lockDirectory}.recovery`;
	const ownerIdentity = await inspectProcess(process.pid);
	if (!ownerIdentity) {
		throw new Error("Unable to verify the PID file recovery owner process");
	}
	const prepared = await preparePidFileLockClaim(
		recoveryDirectory,
		ownerIdentity,
	);
	let recoveryAcquired = false;

	try {
		if (await pathExists(recoveryDirectory)) {
			if (
				!(await removeAbandonedPidFileLockClaim(
					recoveryDirectory,
					inspectProcess,
				))
			) {
				return false;
			}
		}
		try {
			await fs.rename(prepared.candidateDirectory, recoveryDirectory);
			recoveryAcquired = true;
		} catch (error) {
			if (
				isNodeError(error) &&
				(error.code === "EEXIST" || error.code === "ENOTEMPTY")
			) {
				return false;
			}
			throw error;
		}

		const current = await readPidFileLockState(lockDirectory);
		if (
			!current ||
			current.content !== observed.content ||
			(await isPidFileLockOwnerActive(current.record, inspectProcess))
		) {
			return false;
		}
		const recoveryState = await readPidFileLockState(recoveryDirectory);
		if (recoveryState?.content !== prepared.content) return false;

		const abandonedDirectory = `${lockDirectory}.abandoned.${process.pid}.${randomBytes(8).toString("hex")}`;
		try {
			await fs.rename(lockDirectory, abandonedDirectory);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") return true;
			throw error;
		}

		const moved = await readPidFileLockState(abandonedDirectory);
		if (!moved || moved.content !== observed.content) {
			await fs.rename(abandonedDirectory, lockDirectory).catch(() => undefined);
			return false;
		}
		await fs.rm(abandonedDirectory, { recursive: true, force: true });
		return true;
	} finally {
		if (recoveryAcquired) {
			await releasePidFileLockClaim(recoveryDirectory, prepared.content);
		}
		await fs.rm(prepared.candidateDirectory, {
			recursive: true,
			force: true,
		});
	}
};

const withPidFileLock = async <T>(
	pidFile: string,
	operation: () => Promise<T>,
	inspectProcess: InspectPidFileLockProcess = inspectDaemonProcess,
): Promise<T> => {
	const lockDirectory = `${pidFile}.lock`;
	const recoveryDirectory = `${lockDirectory}.recovery`;
	const ownerIdentity =
		inspectProcess === inspectDaemonProcess
			? await getCurrentPidFileLockIdentity()
			: await inspectProcess(process.pid);
	if (!ownerIdentity) {
		throw new Error("Unable to verify the PID file lock owner process");
	}
	const prepared = await preparePidFileLockClaim(lockDirectory, ownerIdentity);
	let acquired = false;
	try {
		for (let attempt = 0; attempt < PID_FILE_LOCK_RETRY_COUNT; attempt++) {
			if (await pathExists(recoveryDirectory)) {
				if (
					await removeAbandonedPidFileLockClaim(
						recoveryDirectory,
						inspectProcess,
					)
				) {
					continue;
				}
				await throwIfPidFileLockHasNoVerifiableOwner(recoveryDirectory);
				await delay(PID_FILE_LOCK_RETRY_MS);
				continue;
			}
			if (await pathExists(lockDirectory)) {
				if (await recoverAbandonedPidFileLock(lockDirectory, inspectProcess)) {
					continue;
				}
				await throwIfPidFileLockHasNoVerifiableOwner(lockDirectory);
				await delay(PID_FILE_LOCK_RETRY_MS);
				continue;
			}
			try {
				await fs.rename(prepared.candidateDirectory, lockDirectory);
			} catch (error) {
				if (
					!isNodeError(error) ||
					(error.code !== "EEXIST" && error.code !== "ENOTEMPTY")
				) {
					throw error;
				}
				if (await recoverAbandonedPidFileLock(lockDirectory, inspectProcess)) {
					continue;
				}
				await throwIfPidFileLockHasNoVerifiableOwner(lockDirectory);
				await delay(PID_FILE_LOCK_RETRY_MS);
				continue;
			}
			acquired = true;
			if (await pathExists(recoveryDirectory)) {
				if (
					!(await removeAbandonedPidFileLockClaim(
						recoveryDirectory,
						inspectProcess,
					))
				) {
					await fs.rename(lockDirectory, prepared.candidateDirectory);
					acquired = false;
					await throwIfPidFileLockHasNoVerifiableOwner(recoveryDirectory);
					await delay(PID_FILE_LOCK_RETRY_MS);
					continue;
				}
			}
			break;
		}
		if (!acquired) {
			throw new Error(`Daemon PID file is busy: ${pidFile}`);
		}
		try {
			return await operation();
		} finally {
			await releasePidFileLockClaim(lockDirectory, prepared.content);
		}
	} finally {
		if (!acquired) {
			await fs.rm(prepared.candidateDirectory, {
				recursive: true,
				force: true,
			});
		}
	}
};

export async function removeDaemonPidFile(
	pidFile: string,
	expectedContent: string,
	inspectProcess: InspectPidFileLockProcess = inspectDaemonProcess,
): Promise<boolean> {
	return withPidFileLock(
		pidFile,
		async () => {
			let currentContent: string;
			try {
				currentContent = await fs.readFile(pidFile, "utf8");
			} catch (error) {
				if (isNodeError(error) && error.code === "ENOENT") return false;
				throw error;
			}
			if (currentContent !== expectedContent) return false;
			await fs.unlink(pidFile);
			return true;
		},
		inspectProcess,
	);
}

const isDaemonPidRecord = (value: unknown): value is DaemonPidRecord => {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<DaemonPidRecord>;
	const processIdentity = record.process as
		| Partial<DaemonPidRecord["process"]>
		| undefined;
	return (
		record.version === 1 &&
		typeof record.pid === "number" &&
		Number.isSafeInteger(record.pid) &&
		record.pid > 0 &&
		typeof record.instanceId === "string" &&
		/^[a-f0-9]{16}$/.test(record.instanceId) &&
		processIdentity !== undefined &&
		(processIdentity.platform === "linux" ||
			processIdentity.platform === "darwin" ||
			processIdentity.platform === "win32") &&
		(processIdentity.platform === "win32"
			? typeof processIdentity.uid === "string" &&
				processIdentity.uid.length > 0 &&
				processIdentity.uid.length <= 256
			: typeof processIdentity.uid === "number" &&
				Number.isSafeInteger(processIdentity.uid) &&
				processIdentity.uid >= 0) &&
		typeof processIdentity.startTime === "string" &&
		processIdentity.startTime.length > 0 &&
		processIdentity.startTime.length <= 256
	);
};

const readDaemonPidState = async (
	pidFile: string,
): Promise<DaemonPidState | null> => {
	let content: string;
	try {
		content = await fs.readFile(pidFile, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return null;
		throw error;
	}
	const normalizedContent = content.trim();
	if (/^[1-9]\d*$/.test(normalizedContent)) {
		const pid = Number(normalizedContent);
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			throw new Error(`Invalid daemon PID file: ${pidFile}`);
		}
		return { kind: "legacy", content, pid };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`Invalid daemon PID file: ${pidFile}`);
	}
	if (!isDaemonPidRecord(parsed)) {
		throw new Error(`Invalid daemon PID file: ${pidFile}`);
	}
	return { kind: "record", content, record: parsed };
};

const getDaemonIdentityState = async (
	record: DaemonPidRecord,
	control: DaemonProcessControl,
): Promise<DaemonIdentityState> => {
	const currentUid = await control.currentUid();
	if (currentUid === null) {
		throw new Error(
			"Daemon process ownership cannot be verified on this platform",
		);
	}
	if (record.process.uid !== currentUid) {
		throw new Error(
			`Daemon process ${record.pid} is not owned by the current user`,
		);
	}
	const identity = await control.inspectProcess(record.pid);
	if (identity === null) return "missing";
	if (
		identity.platform !== record.process.platform ||
		identity.uid !== record.process.uid ||
		identity.startTime !== record.process.startTime ||
		(record.process.platform !== "win32" &&
			identity.instanceId !== record.instanceId)
	) {
		return "mismatch";
	}
	return "matches";
};

type LegacyDaemonIdentityCheck = {
	state: DaemonIdentityState;
	token?: Pick<DaemonProcessIdentity, "platform" | "uid" | "startTime">;
};

const inspectLegacyDaemonIdentity = async (
	pid: number,
	control: DaemonProcessControl,
	expectedIdentity?: Pick<
		DaemonProcessIdentity,
		"platform" | "uid" | "startTime"
	>,
): Promise<LegacyDaemonIdentityCheck> => {
	const currentUid = await control.currentUid();
	if (currentUid === null) {
		throw new Error(
			"Daemon process ownership cannot be verified on this platform",
		);
	}
	const identity = await control.inspectProcess(pid);
	if (identity === null) return { state: "missing" };
	if (
		expectedIdentity &&
		(identity.platform !== expectedIdentity.platform ||
			identity.uid !== expectedIdentity.uid ||
			identity.startTime !== expectedIdentity.startTime)
	) {
		return { state: "mismatch" };
	}
	if (identity.uid !== currentUid) {
		return { state: "mismatch" };
	}
	const commandState = getLegacyMobvibeCommandState(identity);
	if (commandState !== "matches") return { state: commandState };
	return {
		state: "matches",
		token: {
			platform: identity.platform,
			uid: identity.uid,
			startTime: identity.startTime,
		},
	};
};

const getLegacyDaemonIdentityState = async (
	pid: number,
	control: DaemonProcessControl,
	expectedIdentity?: Pick<
		DaemonProcessIdentity,
		"platform" | "uid" | "startTime"
	>,
): Promise<DaemonIdentityState> =>
	(await inspectLegacyDaemonIdentity(pid, control, expectedIdentity)).state;

const getDaemonPidStateIdentity = async (
	state: DaemonPidState,
	control: DaemonProcessControl,
): Promise<DaemonIdentityState> =>
	state.kind === "record"
		? getDaemonIdentityState(state.record, control)
		: getLegacyDaemonIdentityState(state.pid, control);

const getPidFromState = (state: DaemonPidState): number =>
	state.kind === "record" ? state.record.pid : state.pid;

const createUnverifiableLegacyDaemonError = (
	pid: number,
	pidFile: string,
): Error =>
	new Error(
		`Legacy daemon PID ${pid} cannot be safely verified because its relative entrypoint has no verifiable Mobvibe package identity. Inspect PID ${pid} and confirm it is not the Mobvibe daemon before manually removing ${pidFile}.`,
	);

const removeStoppedDaemonPidState = async (
	pidFile: string,
	state: DaemonPidState,
): Promise<void> => {
	const removed = await removeDaemonPidFile(pidFile, state.content);
	if (!removed) return;
	if (state.kind === "legacy") return;
	await fs
		.unlink(daemonIdentityFilePath(pidFile, state.record.instanceId))
		.catch((error: unknown) => {
			if (!isNodeError(error) || error.code !== "ENOENT") throw error;
		});
};

export async function getDaemonPid(
	pidFile: string,
	control: DaemonProcessControl = daemonProcessControl,
): Promise<number | null> {
	const state = await readDaemonPidState(pidFile);
	if (!state) return null;
	const identityState = await getDaemonPidStateIdentity(state, control);
	if (identityState === "unverifiable") {
		throw createUnverifiableLegacyDaemonError(getPidFromState(state), pidFile);
	}
	if (identityState === "missing" || identityState === "mismatch") {
		await removeStoppedDaemonPidState(pidFile, state);
		return null;
	}
	return getPidFromState(state);
}

/** Stop the local daemon using only MOBVIBE_HOME state, not credentials. */
export async function stopDaemonByPidFile(
	pidFile: string,
	control: DaemonProcessControl = daemonProcessControl,
): Promise<void> {
	const state = await readDaemonPidState(pidFile);
	if (!state) {
		logger.info("daemon_not_running");
		return;
	}
	const pid = getPidFromState(state);
	let expectedLegacyIdentity:
		| Pick<DaemonProcessIdentity, "platform" | "uid" | "startTime">
		| undefined;
	let initialIdentityState: DaemonIdentityState;
	if (state.kind === "legacy") {
		const initialCheck = await inspectLegacyDaemonIdentity(state.pid, control);
		initialIdentityState = initialCheck.state;
		expectedLegacyIdentity = initialCheck.token;
	} else {
		initialIdentityState = await getDaemonIdentityState(state.record, control);
	}
	const getCurrentIdentityState = (): Promise<DaemonIdentityState> =>
		state.kind === "legacy"
			? getLegacyDaemonIdentityState(state.pid, control, expectedLegacyIdentity)
			: getDaemonIdentityState(state.record, control);
	const requireVerifiableIdentityState = (
		identityState: DaemonIdentityState,
	): Exclude<DaemonIdentityState, "unverifiable"> => {
		if (identityState === "unverifiable") {
			throw createUnverifiableLegacyDaemonError(pid, pidFile);
		}
		return identityState;
	};
	const getCurrentVerifiableIdentityState = async (): Promise<
		Exclude<DaemonIdentityState, "unverifiable">
	> => requireVerifiableIdentityState(await getCurrentIdentityState());
	const verifiedInitialIdentityState =
		requireVerifiableIdentityState(initialIdentityState);
	if (
		verifiedInitialIdentityState === "missing" ||
		verifiedInitialIdentityState === "mismatch"
	) {
		await removeStoppedDaemonPidState(pidFile, state);
		logger.info("daemon_not_running");
		return;
	}

	try {
		logger.info({ pid }, "daemon_stop_sigterm");
		control.kill(pid, "SIGTERM");
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ESRCH") throw error;
		const identityState = await getCurrentVerifiableIdentityState();
		if (identityState === "missing" || identityState === "mismatch") {
			await removeStoppedDaemonPidState(pidFile, state);
			return;
		}
		throw error;
	}

	const startTime = control.now();
	while (control.now() - startTime < 5000) {
		await control.wait(100);
		const identityState = await getCurrentVerifiableIdentityState();
		if (identityState === "missing" || identityState === "mismatch") {
			logger.info({ pid }, "daemon_stopped_gracefully");
			await removeStoppedDaemonPidState(pidFile, state);
			return;
		}
	}

	const identityStateBeforeForceKill =
		await getCurrentVerifiableIdentityState();
	if (
		identityStateBeforeForceKill === "missing" ||
		identityStateBeforeForceKill === "mismatch"
	) {
		logger.info({ pid }, "daemon_stopped_gracefully");
		await removeStoppedDaemonPidState(pidFile, state);
		return;
	}

	logger.warn({ pid }, "daemon_force_kill_start");
	try {
		control.kill(pid, "SIGKILL");
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ESRCH") throw error;
		const identityState = await getCurrentVerifiableIdentityState();
		if (identityState === "missing" || identityState === "mismatch") {
			await removeStoppedDaemonPidState(pidFile, state);
			return;
		}
		throw error;
	}
	await control.wait(500);
	const finalIdentityState = await getCurrentVerifiableIdentityState();
	if (finalIdentityState === "missing" || finalIdentityState === "mismatch") {
		logger.warn({ pid }, "daemon_force_kill_complete");
		await removeStoppedDaemonPidState(pidFile, state);
		return;
	}
	throw new Error(`Daemon process ${pid} did not stop after SIGKILL`);
}

export class DaemonManager {
	private ownedPidRecordContent: string | undefined;
	private identityFileHandle: FileHandle | undefined;
	private identityFilePath: string | undefined;

	constructor(
		private readonly config: CliConfig,
		private readonly processControl: DaemonProcessControl = daemonProcessControl,
	) {}

	async ensureHomeDirectory(): Promise<void> {
		await fs.mkdir(this.config.homePath, { recursive: true });
		await fs.mkdir(this.config.logPath, { recursive: true });
	}

	async getPid(): Promise<number | null> {
		return getDaemonPid(this.config.pidFile, this.processControl);
	}

	async writePidFile(pid: number): Promise<void> {
		if (pid !== process.pid) {
			throw new Error(`Cannot create daemon identity for foreign PID ${pid}`);
		}
		const instanceId = randomBytes(8).toString("hex");
		const identityPath = daemonIdentityFilePath(
			this.config.pidFile,
			instanceId,
		);
		let identityHandle: FileHandle | undefined;
		try {
			identityHandle = await fs.open(identityPath, "wx", 0o600);
			const identity = await this.processControl.inspectProcess(pid);
			if (identity === null) {
				throw new Error(`Cannot verify daemon process ${pid}`);
			}
			const currentUid = await this.processControl.currentUid();
			if (currentUid === null || identity.uid !== currentUid) {
				throw new Error(`Cannot verify ownership of daemon process ${pid}`);
			}
			if (identity.platform !== "win32" && identity.instanceId !== instanceId) {
				throw new Error(
					`Cannot verify daemon instance identity for PID ${pid}`,
				);
			}
			const record: DaemonPidRecord = {
				version: 1,
				pid,
				instanceId,
				process: {
					platform: identity.platform,
					uid: identity.uid,
					startTime: identity.startTime,
				},
			};
			const content = JSON.stringify(record);
			await withPidFileLock(this.config.pidFile, async () => {
				try {
					await fs.access(this.config.pidFile);
					throw new Error(
						`Daemon PID file already exists: ${this.config.pidFile}`,
					);
				} catch (error) {
					if (!isNodeError(error) || error.code !== "ENOENT") throw error;
				}

				const temporaryPidFile = `${this.config.pidFile}.${pid}.${instanceId}.tmp`;
				try {
					await fs.writeFile(temporaryPidFile, content, {
						encoding: "utf8",
						flag: "wx",
						mode: 0o600,
					});
					await fs.rename(temporaryPidFile, this.config.pidFile);
				} finally {
					await fs.unlink(temporaryPidFile).catch((error: unknown) => {
						if (!isNodeError(error) || error.code !== "ENOENT") throw error;
					});
				}
			});
			this.ownedPidRecordContent = content;
			this.identityFileHandle = identityHandle;
			this.identityFilePath = identityPath;
			identityHandle = undefined;
		} finally {
			if (identityHandle) {
				await identityHandle.close();
				await fs.unlink(identityPath).catch((error: unknown) => {
					if (!isNodeError(error) || error.code !== "ENOENT") throw error;
				});
			}
		}
	}

	async removePidFile(): Promise<void> {
		if (!this.ownedPidRecordContent) {
			logger.warn("daemon_pid_remove_without_owned_record");
			return;
		}
		try {
			await removeDaemonPidFile(
				this.config.pidFile,
				this.ownedPidRecordContent,
			);
		} finally {
			this.ownedPidRecordContent = undefined;
			const identityHandle = this.identityFileHandle;
			const identityPath = this.identityFilePath;
			this.identityFileHandle = undefined;
			this.identityFilePath = undefined;
			if (identityHandle) await identityHandle.close();
			if (identityPath) {
				await fs.unlink(identityPath).catch((error: unknown) => {
					if (!isNodeError(error) || error.code !== "ENOENT") throw error;
				});
			}
		}
	}

	async status(): Promise<DaemonStatus> {
		const pid = await this.getPid();
		if (!pid) {
			return { running: false };
		}
		return { running: true, pid };
	}

	async start(options?: {
		foreground?: boolean;
		noE2ee?: boolean;
	}): Promise<void> {
		const existingPid = await this.getPid();
		if (existingPid) {
			logger.info({ pid: existingPid }, "daemon_already_running");
			return;
		}

		await this.ensureHomeDirectory();

		if (options?.foreground) {
			await this.runForeground({ noE2ee: options.noE2ee });
		} else {
			await this.spawnBackground({ noE2ee: options?.noE2ee });
		}
	}

	async stop(): Promise<void> {
		await stopDaemonByPidFile(this.config.pidFile, this.processControl);
	}

	protected async spawnBackground(options?: {
		noE2ee?: boolean;
	}): Promise<void> {
		const logFile = path.join(
			this.config.logPath,
			`${new Date().toISOString().replace(/[:.]/g, "-")}-daemon.log`,
		);

		const args = buildBackgroundSpawnArgs(process.argv, options);

		// Open log file for direct stdio redirection (no pipe, parent can exit immediately)
		const logFd = await fs.open(logFile, "a");

		const child = spawn(process.execPath, args, {
			detached: true,
			stdio: ["ignore", logFd.fd, logFd.fd],
			env: {
				...process.env,
				MOBVIBE_GATEWAY_URL: this.config.gatewayUrl,
			},
		});

		if (!child.pid) {
			logger.error("daemon_spawn_failed");
			throw new Error("Failed to spawn daemon process");
		}

		// Close parent's fd reference (child has duplicated it)
		await logFd.close();

		// Detach from parent - no event listeners needed since stdio is directly redirected
		// Note: The child process writes its own PID file in runForeground()
		child.unref();

		logger.info({ pid: child.pid }, "daemon_started");
		console.log(`Logs: ${logFile}`);
		logger.info({ logFile }, "daemon_log_path");
	}

	async runForeground(options?: { noE2ee?: boolean }): Promise<void> {
		const pid = process.pid;
		await this.writePidFile(pid);

		logger.info({ pid }, "daemon_starting");
		logger.info({ gatewayUrl: this.config.gatewayUrl }, "daemon_gateway_url");
		logger.info({ machineId: this.config.machineId }, "daemon_machine_id");
		logger.info({ noE2ee: options?.noE2ee === true }, "daemon_e2ee_mode");

		const cryptoService = await this.createRuntimeCryptoService(options);
		logger.info("daemon_crypto_initialized");

		const sessionManager = this.createSessionManager(cryptoService);
		const socketClient = this.createSocketClient(sessionManager, cryptoService);

		// Initialize compactor if enabled
		let compactor: WalCompactor | undefined;
		let compactionInterval: NodeJS.Timeout | undefined;
		// P1-2: Track compactor resources for cleanup on shutdown
		let compactorWalStore: WalStore | undefined;
		let compactorDb: Database | undefined;
		let compactorResourcesClosed = false;
		const closeCompactorResources = () => {
			if (compactorResourcesClosed) return;
			compactorResourcesClosed = true;
			try {
				compactorWalStore?.close();
			} catch (error) {
				logger.error({ err: error }, "compactor_wal_store_close_error");
			}
			try {
				compactorDb?.close();
			} catch (error) {
				logger.error({ err: error }, "compactor_db_close_error");
			}
		};
		const compactionRuns = new Set<Promise<unknown>>();
		const startCompaction = (source: "startup" | "scheduled") => {
			if (!compactor) return;
			let run: Promise<unknown>;
			try {
				run = compactor.compactAll();
			} catch (error) {
				logger.error({ err: error }, `compaction_${source}_error`);
				return;
			}
			compactionRuns.add(run);
			void run.then(
				() => {
					compactionRuns.delete(run);
				},
				(error) => {
					compactionRuns.delete(run);
					logger.error({ err: error }, `compaction_${source}_error`);
				},
			);
		};

		if (this.config.compaction.enabled) {
			compactorWalStore = new WalStore(this.config.walDbPath);
			compactorDb = new Database(this.config.walDbPath);
			compactor = this.createWalCompactor(
				compactorWalStore,
				this.config.compaction,
				compactorDb,
			);

			// Run compaction on startup
			if (this.config.compaction.runOnStartup) {
				logger.info("compaction_startup_start");
				startCompaction("startup");
			}

			// Schedule periodic compaction
			const intervalMs =
				this.config.compaction.runIntervalHours * 60 * 60 * 1000;
			compactionInterval = setInterval(() => {
				logger.info("compaction_scheduled_start");
				startCompaction("scheduled");
			}, intervalMs);

			logger.info(
				{ intervalHours: this.config.compaction.runIntervalHours },
				"compaction_scheduled",
			);
		}

		let shuttingDown = false;
		let resolveShutdown: () => void = () => {};
		const shutdownComplete = new Promise<void>((resolve) => {
			resolveShutdown = resolve;
		});

		const shutdown = async (signal: string) => {
			if (shuttingDown) {
				logger.warn({ signal }, "daemon_shutdown_already_running");
				return;
			}
			shuttingDown = true;

			logger.info({ signal }, "daemon_shutdown_start");

			try {
				// Stop compaction interval
				if (compactionInterval) {
					clearInterval(compactionInterval);
				}
				const pendingCompactions = Array.from(compactionRuns);
				if (pendingCompactions.length > 0) {
					logger.info(
						{ count: pendingCompactions.length },
						"compaction_shutdown_wait",
					);
					const allCompactionsSettled = Promise.allSettled(pendingCompactions);
					let timeoutId: NodeJS.Timeout | undefined;
					const completedWithinDeadline = await Promise.race([
						allCompactionsSettled.then(() => true),
						new Promise<false>((resolve) => {
							timeoutId = setTimeout(
								() => resolve(false),
								this.getCompactionShutdownTimeoutMs(),
							);
						}),
					]);
					if (timeoutId) clearTimeout(timeoutId);
					if (!completedWithinDeadline) {
						logger.warn(
							{
								count: pendingCompactions.length,
								timeoutMs: this.getCompactionShutdownTimeoutMs(),
							},
							"compaction_shutdown_timeout",
						);
						void allCompactionsSettled.then(closeCompactorResources);
					} else {
						closeCompactorResources();
					}
				} else {
					closeCompactorResources();
				}

				socketClient.disconnect();
				await sessionManager.shutdown();
				await this.removePidFile();
				logger.info({ signal }, "daemon_shutdown_complete");
			} catch (error) {
				logger.error({ err: error, signal }, "daemon_shutdown_error");
			} finally {
				resolveShutdown();
			}
		};

		const handleSigint = () => {
			shutdown("SIGINT").catch((error) => {
				logger.error({ err: error }, "daemon_shutdown_sigint_error");
			});
		};
		const handleSigterm = () => {
			shutdown("SIGTERM").catch((error) => {
				logger.error({ err: error }, "daemon_shutdown_sigterm_error");
			});
		};

		process.on("SIGINT", handleSigint);
		process.on("SIGTERM", handleSigterm);

		try {
			socketClient.connect();
			await shutdownComplete;
		} catch (error) {
			await shutdown("startup_error");
			throw error;
		} finally {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
		}
	}

	protected getCompactionShutdownTimeoutMs(): number {
		return COMPACTION_SHUTDOWN_TIMEOUT_MS;
	}

	protected async createRuntimeCryptoService(options?: {
		noE2ee?: boolean;
	}): Promise<CliCryptoService> {
		await initCrypto();
		const masterSecretBase64 = await getMasterSecret();
		if (!masterSecretBase64) {
			logger.error("daemon_master_secret_missing");
			console.error(
				`[mobvibe-cli] No credentials found. Run 'mobvibe login' to authenticate.`,
			);
			logger.warn("daemon_exit_missing_master_secret");
			process.exit(1);
		}
		const masterSecret = base64ToUint8(masterSecretBase64);
		return new CliCryptoService(masterSecret, {
			contentEncryptionEnabled: !options?.noE2ee,
		});
	}

	protected createSessionManager(
		cryptoService: CliCryptoService,
	): SessionManager {
		return new SessionManager(this.config, cryptoService);
	}

	protected createWalCompactor(
		walStore: WalStore,
		config: CliConfig["compaction"],
		db: Database,
	): WalCompactor {
		return new WalCompactor(walStore, config, db);
	}

	protected createSocketClient(
		sessionManager: SessionManager,
		cryptoService: CliCryptoService,
	): SocketClient {
		return new SocketClient({
			config: this.config,
			sessionManager,
			cryptoService,
		});
	}

	async logs(options?: { follow?: boolean; lines?: number }): Promise<void> {
		const files = await fs.readdir(this.config.logPath);
		const logFiles = files
			.filter((f) => f.endsWith("-daemon.log"))
			.sort()
			.reverse();

		if (logFiles.length === 0) {
			logger.warn("daemon_logs_empty");
			console.log("No log files found");
			return;
		}

		const latestLog = path.join(this.config.logPath, logFiles[0]);
		logger.info({ logFile: latestLog }, "daemon_logs_latest");
		console.log(`Log file: ${latestLog}\n`);

		if (options?.follow) {
			// Use tail -f
			const tail = spawn("tail", ["-f", latestLog], {
				stdio: "inherit",
			});
			await new Promise<void>((resolve) => {
				tail.on("close", () => resolve());
			});
		} else {
			const content = await fs.readFile(latestLog, "utf8");
			const lines = content.split("\n");
			const count = options?.lines ?? 50;
			console.log(lines.slice(-count).join("\n"));
		}
	}
}
