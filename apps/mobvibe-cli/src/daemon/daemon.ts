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

type SupportedDaemonPlatform = "darwin" | "linux";

export type DaemonProcessIdentity = {
	platform: SupportedDaemonPlatform;
	uid: number;
	startTime: string;
	instanceId: string | null;
};

export type DaemonPidRecord = {
	version: 1;
	pid: number;
	instanceId: string;
	process: Omit<DaemonProcessIdentity, "instanceId">;
};

type DaemonPidState = {
	content: string;
	record: DaemonPidRecord;
};

type DaemonIdentityState = "matches" | "missing" | "mismatch";

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
	error instanceof Error && "code" in error;

export type DaemonProcessControl = {
	kill: (pid: number, signal: NodeJS.Signals | 0) => void;
	inspectProcess: (pid: number) => Promise<DaemonProcessIdentity | null>;
	currentUid: () => number | null;
	now: () => number;
	wait: (milliseconds: number) => Promise<void>;
};

const daemonIdentityFileName = (instanceId: string): string =>
	`${DAEMON_IDENTITY_FILE_PREFIX}${instanceId}${DAEMON_IDENTITY_FILE_SUFFIX}`;

const daemonIdentityFilePath = (pidFile: string, instanceId: string): string =>
	path.join(path.dirname(pidFile), daemonIdentityFileName(instanceId));

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
		const [statContent, processStat, openFiles] = await Promise.all([
			fs.readFile(path.join(processDirectory, "stat"), "utf8"),
			fs.stat(processDirectory),
			readLinuxOpenFiles(pid),
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

export type DarwinProcessInspection = {
	runPs: (pid: number) => Promise<string | null>;
	runLsof: (pid: number) => Promise<string[] | null>;
};

export const inspectDarwinProcess = async (
	pid: number,
	inspection: DarwinProcessInspection = { runPs, runLsof },
): Promise<DaemonProcessIdentity | null> => {
	const output = await inspection.runPs(pid);
	if (output === null || output.trim() === "") return null;
	const openFiles = await inspection.runLsof(pid);
	if (openFiles === null) {
		throw new Error(`Unable to inspect open files for daemon process ${pid}`);
	}
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
	};
};

const inspectDaemonProcess = async (
	pid: number,
): Promise<DaemonProcessIdentity | null> => {
	if (process.platform === "linux") return inspectLinuxProcess(pid);
	if (process.platform === "darwin") return inspectDarwinProcess(pid);
	throw new Error(
		`Daemon process identity verification is unsupported on ${process.platform}`,
	);
};

const daemonProcessControl: DaemonProcessControl = {
	kill: (pid, signal) => {
		process.kill(pid, signal);
	},
	inspectProcess: inspectDaemonProcess,
	currentUid: () => process.getuid?.() ?? null,
	now: Date.now,
	wait: (milliseconds) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

const delay = async (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

const withPidFileLock = async <T>(
	pidFile: string,
	operation: () => Promise<T>,
): Promise<T> => {
	const lockDirectory = `${pidFile}.lock`;
	let acquired = false;
	for (let attempt = 0; attempt < PID_FILE_LOCK_RETRY_COUNT; attempt++) {
		try {
			await fs.mkdir(lockDirectory);
			acquired = true;
			break;
		} catch (error) {
			if (!isNodeError(error) || error.code !== "EEXIST") throw error;
			await delay(PID_FILE_LOCK_RETRY_MS);
		}
	}
	if (!acquired) {
		throw new Error(`Daemon PID file is busy: ${pidFile}`);
	}
	try {
		return await operation();
	} finally {
		await fs.rmdir(lockDirectory).catch((error: unknown) => {
			if (!isNodeError(error) || error.code !== "ENOENT") throw error;
		});
	}
};

export async function removeDaemonPidFile(
	pidFile: string,
	expectedContent: string,
): Promise<boolean> {
	return withPidFileLock(pidFile, async () => {
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
	});
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
			processIdentity.platform === "darwin") &&
		typeof processIdentity.uid === "number" &&
		Number.isSafeInteger(processIdentity.uid) &&
		processIdentity.uid >= 0 &&
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
		throw new Error(
			`Unsafe legacy daemon PID file cannot be verified: ${pidFile}`,
		);
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
	return { content, record: parsed };
};

const getDaemonIdentityState = async (
	record: DaemonPidRecord,
	control: DaemonProcessControl,
): Promise<DaemonIdentityState> => {
	const currentUid = control.currentUid();
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
		identity.instanceId !== record.instanceId
	) {
		return "mismatch";
	}
	return "matches";
};

const removeStoppedDaemonPidState = async (
	pidFile: string,
	state: DaemonPidState,
): Promise<void> => {
	const removed = await removeDaemonPidFile(pidFile, state.content);
	if (!removed) return;
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
	const identityState = await getDaemonIdentityState(state.record, control);
	if (identityState === "missing") {
		await removeStoppedDaemonPidState(pidFile, state);
		return null;
	}
	if (identityState === "mismatch") {
		throw new Error(
			`Daemon process ${state.record.pid} identity no longer matches its PID file`,
		);
	}
	return state.record.pid;
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
	const { pid } = state.record;
	const initialIdentityState = await getDaemonIdentityState(
		state.record,
		control,
	);
	if (initialIdentityState === "missing") {
		await removeStoppedDaemonPidState(pidFile, state);
		logger.info("daemon_not_running");
		return;
	}
	if (initialIdentityState === "mismatch") {
		throw new Error(
			`Daemon process ${pid} identity no longer matches its PID file`,
		);
	}

	try {
		logger.info({ pid }, "daemon_stop_sigterm");
		control.kill(pid, "SIGTERM");
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ESRCH") throw error;
		const identityState = await getDaemonIdentityState(state.record, control);
		if (identityState === "missing") {
			await removeStoppedDaemonPidState(pidFile, state);
			return;
		}
		if (identityState === "mismatch") return;
		throw error;
	}

	const startTime = control.now();
	while (control.now() - startTime < 5000) {
		await control.wait(100);
		const identityState = await getDaemonIdentityState(state.record, control);
		if (identityState === "missing") {
			logger.info({ pid }, "daemon_stopped_gracefully");
			await removeStoppedDaemonPidState(pidFile, state);
			return;
		}
		if (identityState === "mismatch") return;
	}

	const identityStateBeforeForceKill = await getDaemonIdentityState(
		state.record,
		control,
	);
	if (identityStateBeforeForceKill === "missing") {
		logger.info({ pid }, "daemon_stopped_gracefully");
		await removeStoppedDaemonPidState(pidFile, state);
		return;
	}
	if (identityStateBeforeForceKill === "mismatch") return;

	logger.warn({ pid }, "daemon_force_kill_start");
	try {
		control.kill(pid, "SIGKILL");
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ESRCH") throw error;
		const identityState = await getDaemonIdentityState(state.record, control);
		if (identityState === "missing") {
			await removeStoppedDaemonPidState(pidFile, state);
			return;
		}
		if (identityState === "mismatch") return;
		throw error;
	}
	await control.wait(500);
	const finalIdentityState = await getDaemonIdentityState(
		state.record,
		control,
	);
	if (finalIdentityState === "missing") {
		logger.warn({ pid }, "daemon_force_kill_complete");
		await removeStoppedDaemonPidState(pidFile, state);
		return;
	}
	if (finalIdentityState === "mismatch") return;
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
			const currentUid = this.processControl.currentUid();
			if (currentUid === null || identity.uid !== currentUid) {
				throw new Error(`Cannot verify ownership of daemon process ${pid}`);
			}
			if (identity.instanceId !== instanceId) {
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
