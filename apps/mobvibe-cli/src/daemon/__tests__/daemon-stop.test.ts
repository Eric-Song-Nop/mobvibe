import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CliConfig } from "../../config.js";
import {
	DaemonManager,
	type DaemonPidRecord,
	type DaemonProcessControl,
	type DaemonProcessIdentity,
	getDaemonPid,
	inspectDarwinProcess,
	inspectWindowsProcess,
	removeDaemonPidFile,
	stopDaemonByPidFile,
} from "../daemon.js";

const processError = (code: string): NodeJS.ErrnoException =>
	Object.assign(new Error(code), { code });

const ownerUid = process.getuid?.() ?? 1000;

const processIdentity = (
	instanceId: string | null,
	startTime = "linux-start-100",
): DaemonProcessIdentity => ({
	platform: "linux",
	uid: ownerUid,
	startTime,
	instanceId,
});

const lockOwnerRecord = (
	pid: number,
	identity: DaemonProcessIdentity,
	nonce = "0123456789abcdef",
) => ({
	version: 1,
	pid,
	nonce,
	process: {
		platform: identity.platform,
		uid: identity.uid,
		startTime: identity.startTime,
	},
});

const pidRecord = (
	pid = 4242,
	instanceId = "0123456789abcdef",
	startTime = "linux-start-100",
): DaemonPidRecord => ({
	version: 1,
	pid,
	instanceId,
	process: {
		platform: "linux",
		uid: ownerUid,
		startTime,
	},
});

const writePidRecord = async (
	pidFile: string,
	record: DaemonPidRecord = pidRecord(),
): Promise<string> => {
	const content = JSON.stringify(record);
	await fs.writeFile(pidFile, content, "utf8");
	return content;
};

const unusedControl = (): DaemonProcessControl => ({
	kill: () => {
		throw new Error("process control should not be called");
	},
	inspectProcess: async () => {
		throw new Error("process control should not be called");
	},
	currentUid: () => ownerUid,
	now: () => 0,
	wait: async () => undefined,
});

describe("stopDaemonByPidFile", () => {
	let tempDir: string;
	let pidFile: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobvibe-stop-"));
		pidFile = path.join(tempDir, "daemon.pid");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("treats a missing pid file as an already-stopped daemon", async () => {
		await expect(
			stopDaemonByPidFile(pidFile, unusedControl()),
		).resolves.toBeUndefined();
	});

	test("removes an orphan identity file after compare-deleting a stopped daemon record", async () => {
		const record = pidRecord();
		await writePidRecord(pidFile, record);
		const identityFile = path.join(
			tempDir,
			`.mobvibe-daemon-${record.instanceId}.identity`,
		);
		await fs.writeFile(identityFile, "", { mode: 0o600 });
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => null,
		};

		await stopDaemonByPidFile(pidFile, control);

		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fs.stat(identityFile)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("keeps an orphan identity file when a new daemon record wins the cleanup race", async () => {
		const record = pidRecord();
		await writePidRecord(pidFile, record);
		const identityFile = path.join(
			tempDir,
			`.mobvibe-daemon-${record.instanceId}.identity`,
		);
		await fs.writeFile(identityFile, "", { mode: 0o600 });
		const replacement = JSON.stringify(
			pidRecord(5252, "abcdef0123456789", "linux-start-300"),
		);
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => {
				await fs.writeFile(pidFile, replacement, "utf8");
				return null;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(await fs.readFile(pidFile, "utf8")).toBe(replacement);
		await expect(fs.stat(identityFile)).resolves.toBeDefined();
	});

	test("rejects an invalid pid record without deleting evidence", async () => {
		await fs.writeFile(pidFile, "not-json");

		await expect(stopDaemonByPidFile(pidFile, unusedControl())).rejects.toThrow(
			"Invalid daemon PID file",
		);
		expect(await fs.readFile(pidFile, "utf8")).toBe("not-json");
	});

	test("removes a stopped legacy PID-only file without signaling", async () => {
		await fs.writeFile(pidFile, "4242");
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			kill: (_pid, signal) => signals.push(signal),
			inspectProcess: async () => null,
		};

		await expect(
			stopDaemonByPidFile(pidFile, control),
		).resolves.toBeUndefined();

		expect(signals).toEqual([]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("recognizes and stops a same-owner legacy Mobvibe daemon", async () => {
		await fs.writeFile(pidFile, "4242");
		let running = true;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () =>
				running
					? {
							...processIdentity(null),
							commandLine: ["mobvibe", "start", "--foreground"],
						}
					: null,
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === "SIGTERM") running = false;
			},
		};

		expect(await getDaemonPid(pidFile, control)).toBe(4242);
		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("recognizes a legacy daemon launched from a relative development entrypoint", async () => {
		await fs.writeFile(pidFile, "4242");
		let running = true;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () =>
				running
					? {
							...processIdentity(null),
							commandLine: ["bun", "dist/index.js", "start", "--foreground"],
							cwd: "/repo/apps/mobvibe-cli",
							cwdPackageName: "@mobvibe/cli",
						}
					: null,
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === "SIGTERM") running = false;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("gets and stops the real legacy Bun watch development command", async () => {
		await fs.writeFile(pidFile, "4242");
		let running = true;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () =>
				running
					? {
							...processIdentity(null),
							commandLine: [
								"bun",
								"--watch",
								"src/index.ts",
								"start",
								"--foreground",
							],
							cwd: "/repo/apps/mobvibe-cli",
							cwdPackageName: "@mobvibe/cli",
						}
					: null,
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === "SIGTERM") running = false;
			},
		};

		expect(await getDaemonPid(pidFile, control)).toBe(4242);
		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("keeps a Windows-like legacy PID when its relative entrypoint has no cwd", async () => {
		await fs.writeFile(pidFile, "4242");
		const ownerSid = "S-1-5-21-111-222-333-1001";
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			currentUid: () => ownerSid,
			inspectProcess: async () => ({
				platform: "win32",
				uid: ownerSid,
				startTime: "2026-07-17T08:00:00.0000000Z",
				instanceId: null,
				commandLine: [
					"C:\\Program Files\\Bun\\bun.exe",
					"src/index.ts",
					"start",
					"--foreground",
				],
			}),
			kill: (_pid, signal) => signals.push(signal),
		};

		await expect(getDaemonPid(pidFile, control)).rejects.toThrow(
			"Legacy daemon PID 4242 cannot be safely verified",
		);
		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"confirm it is not the Mobvibe daemon before manually removing",
		);

		expect(signals).toEqual([]);
		expect(await fs.readFile(pidFile, "utf8")).toBe("4242");
	});

	test("keeps a legacy PID while its cwd package identity is temporarily unavailable", async () => {
		await fs.writeFile(pidFile, "4242");
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => ({
				...processIdentity(null),
				commandLine: ["bun", "dist/index.js", "start", "--foreground"],
				cwd: "/repo/apps/mobvibe-cli",
			}),
			kill: (_pid, signal) => signals.push(signal),
		};

		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"Legacy daemon PID 4242 cannot be safely verified",
		);

		expect(signals).toEqual([]);
		expect(await fs.readFile(pidFile, "utf8")).toBe("4242");
	});

	test("does not escalate when cwd package evidence disappears after SIGTERM", async () => {
		await fs.writeFile(pidFile, "4242");
		let inspectionCount = 0;
		let clock = 0;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => {
				inspectionCount += 1;
				return {
					...processIdentity(null),
					commandLine: ["bun", "dist/index.js", "start", "--foreground"],
					cwd: "/repo/apps/mobvibe-cli",
					cwdPackageName: inspectionCount === 1 ? "@mobvibe/cli" : undefined,
				};
			},
			kill: (_pid, signal) => signals.push(signal),
			now: () => {
				const current = clock;
				clock += 100;
				return current;
			},
		};

		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"Legacy daemon PID 4242 cannot be safely verified",
		);

		expect(signals).toEqual(["SIGTERM"]);
		expect(await fs.readFile(pidFile, "utf8")).toBe("4242");
	});

	test("gets and stops a direct legacy mobvibe.exe command without cwd evidence", async () => {
		await fs.writeFile(pidFile, "4242");
		const ownerSid = "S-1-5-21-111-222-333-1001";
		let running = true;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			currentUid: () => ownerSid,
			inspectProcess: async () =>
				running
					? {
							platform: "win32",
							uid: ownerSid,
							startTime: "2026-07-17T08:00:00.0000000Z",
							instanceId: null,
							commandLine: ["mobvibe.exe", "start", "--foreground"],
						}
					: null,
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === "SIGTERM") running = false;
			},
		};

		expect(await getDaemonPid(pidFile, control)).toBe(4242);
		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("recognizes a watched Node daemon from an explicit installed package path", async () => {
		await fs.writeFile(pidFile, "4242");
		let running = true;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () =>
				running
					? {
							...processIdentity(null),
							commandLine: [
								"/usr/local/bin/node",
								"--watch",
								"--watch-preserve-output",
								"/opt/node_modules/@mobvibe/cli/dist/index.js",
								"start",
								"--foreground",
							],
						}
					: null,
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === "SIGTERM") running = false;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("never treats an unrelated project's relative dist entrypoint as Mobvibe", async () => {
		await fs.writeFile(pidFile, "4242");
		let clock = -6000;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => ({
				...processIdentity(null),
				commandLine: ["bun", "dist/index.js", "start", "--foreground"],
				cwd: "/tmp/unrelated-project",
				cwdPackageName: "unrelated-project",
			}),
			kill: (_pid, signal) => signals.push(signal),
			now: () => {
				clock += 6000;
				return clock;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual([]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("never treats an incidental Mobvibe argument as the executable", async () => {
		await fs.writeFile(pidFile, "4242");
		let clock = -6000;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => ({
				...processIdentity(null),
				commandLine: ["bun", "server.js", "mobvibe", "start", "--foreground"],
				cwd: "/tmp/unrelated-project",
				cwdPackageName: "unrelated-project",
			}),
			kill: (_pid, signal) => signals.push(signal),
			now: () => {
				clock += 6000;
				return clock;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual([]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("never accepts unsupported Bun --watch=value syntax", async () => {
		await fs.writeFile(pidFile, "4242");
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => ({
				...processIdentity(null),
				commandLine: [
					"bun",
					"--watch=src",
					"src/index.ts",
					"start",
					"--foreground",
				],
				cwd: "/repo/apps/mobvibe-cli",
				cwdPackageName: "@mobvibe/cli",
			}),
			kill: (_pid, signal) => signals.push(signal),
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual([]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("never force-kills a legacy PID reused after SIGTERM", async () => {
		await fs.writeFile(pidFile, "4242");
		let inspectionCount = 0;
		let clock = -6000;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => {
				inspectionCount += 1;
				return {
					...processIdentity(
						null,
						inspectionCount === 1 ? "legacy-start-1" : "reused-start-2",
					),
					commandLine: ["mobvibe", "start", "--foreground"],
				};
			},
			kill: (_pid, signal) => signals.push(signal),
			now: () => {
				clock += 6000;
				return clock;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("never signals a legacy PID reused by a non-Mobvibe process", async () => {
		await fs.writeFile(pidFile, "4242");
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => ({
				...processIdentity(null),
				commandLine: ["/usr/bin/node", "server.js"],
			}),
			kill: (_pid, signal) => signals.push(signal),
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual([]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("never signals a legacy PID owned by another user", async () => {
		await fs.writeFile(pidFile, "4242");
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => ({
				...processIdentity(null),
				uid: ownerUid + 1,
				commandLine: ["mobvibe", "start", "--foreground"],
			}),
			kill: (_pid, signal) => signals.push(signal),
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual([]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("does not signal and compare-deletes a reused PID record", async () => {
		await writePidRecord(pidFile);
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			kill: (_pid, signal) => {
				signals.push(signal);
			},
			inspectProcess: async () =>
				processIdentity("fedcba9876543210", "linux-start-200"),
		};

		await expect(
			stopDaemonByPidFile(pidFile, control),
		).resolves.toBeUndefined();

		expect(signals).toEqual([]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("recovers a PID lock whose recorded owner has exited", async () => {
		const content = await writePidRecord(pidFile);
		const lockDirectory = `${pidFile}.lock`;
		await fs.mkdir(lockDirectory);
		await fs.writeFile(
			path.join(lockDirectory, "owner.json"),
			JSON.stringify(
				lockOwnerRecord(2_147_483_647, processIdentity(null, "exited-owner")),
			),
		);

		await expect(
			removeDaemonPidFile(pidFile, content, async (pid) =>
				pid === process.pid ? processIdentity(null, "current-owner") : null,
			),
		).resolves.toBeTrue();

		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fs.stat(lockDirectory)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("never reclaims an old ownerless lock while a legacy writer may be paused", async () => {
		const content = await writePidRecord(pidFile);
		const lockDirectory = `${pidFile}.lock`;
		await fs.mkdir(lockDirectory);
		const staleTime = new Date(Date.now() - 60_000);
		await fs.utimes(lockDirectory, staleTime, staleTime);

		await expect(
			removeDaemonPidFile(pidFile, content, async () =>
				processIdentity(null, "current-owner"),
			),
		).rejects.toThrow("cannot be safely recovered");

		expect(await fs.readFile(pidFile, "utf8")).toBe(content);
		expect((await fs.stat(lockDirectory)).isDirectory()).toBeTrue();
	});

	test("never reclaims a lock while its recorded owner is alive", async () => {
		const content = await writePidRecord(pidFile);
		const lockDirectory = `${pidFile}.lock`;
		const activeIdentity = processIdentity(null, "active-owner");
		await fs.mkdir(lockDirectory);
		await fs.writeFile(
			path.join(lockDirectory, "owner.json"),
			JSON.stringify(lockOwnerRecord(process.pid, activeIdentity)),
		);
		const staleTime = new Date(Date.now() - 60_000);
		await fs.utimes(lockDirectory, staleTime, staleTime);

		await expect(
			removeDaemonPidFile(pidFile, content, async () => activeIdentity),
		).rejects.toThrow("Daemon PID file is busy");

		expect(await fs.readFile(pidFile, "utf8")).toBe(content);
		expect(
			JSON.parse(
				await fs.readFile(path.join(lockDirectory, "owner.json"), "utf8"),
			),
		).toMatchObject({ pid: process.pid, nonce: "0123456789abcdef" });
	});

	test("reclaims a lock after its owner PID is reused", async () => {
		const content = await writePidRecord(pidFile);
		const lockDirectory = `${pidFile}.lock`;
		await fs.mkdir(lockDirectory);
		await fs.writeFile(
			path.join(lockDirectory, "owner.json"),
			JSON.stringify(
				lockOwnerRecord(process.pid, processIdentity(null, "old-start-time")),
			),
		);

		await expect(
			removeDaemonPidFile(pidFile, content, async () =>
				processIdentity(null, "reused-pid-start-time"),
			),
		).resolves.toBeTrue();

		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("reclaims an orphaned recovery claim after its owner PID is reused", async () => {
		const content = await writePidRecord(pidFile);
		const recoveryDirectory = `${pidFile}.lock.recovery`;
		await fs.mkdir(recoveryDirectory);
		await fs.writeFile(
			path.join(recoveryDirectory, "owner.json"),
			JSON.stringify(
				lockOwnerRecord(
					process.pid,
					processIdentity(null, "old-recovery-start-time"),
				),
			),
		);

		await expect(
			removeDaemonPidFile(pidFile, content, async () =>
				processIdentity(null, "current-recovery-start-time"),
			),
		).resolves.toBeTrue();

		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fs.stat(recoveryDirectory)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	for (const [name, ownerContent] of [
		["has no owner record", undefined],
		["has a corrupt owner record", "{not-json"],
	] as const) {
		test(`fails closed with recovery guidance when a PID recovery claim ${name}`, async () => {
			const content = await writePidRecord(pidFile);
			const recoveryDirectory = `${pidFile}.lock.recovery`;
			await fs.mkdir(recoveryDirectory);
			if (ownerContent !== undefined) {
				await fs.writeFile(
					path.join(recoveryDirectory, "owner.json"),
					ownerContent,
				);
			}

			const error = await removeDaemonPidFile(pidFile, content, async () =>
				processIdentity(null, "current-owner"),
			).then(
				() => null,
				(error: unknown) => error,
			);

			expect(error).toBeInstanceOf(Error);
			if (!(error instanceof Error)) throw error;
			expect(error.message).toContain("cannot be safely recovered");
			expect(error.message).toContain(recoveryDirectory);
			expect(error.message).toContain(
				"Verify that no Mobvibe CLI process is accessing the PID file",
			);
			expect(await fs.readFile(pidFile, "utf8")).toBe(content);
			expect((await fs.stat(recoveryDirectory)).isDirectory()).toBeTrue();
		});
	}

	for (const [name, ownerContent] of [
		["has no owner record", undefined],
		["has a corrupt owner record", "{not-json"],
	] as const) {
		test(`fails closed when an existing PID lock ${name}`, async () => {
			const content = await writePidRecord(pidFile);
			const lockDirectory = `${pidFile}.lock`;
			await fs.mkdir(lockDirectory);
			if (ownerContent !== undefined) {
				await fs.writeFile(
					path.join(lockDirectory, "owner.json"),
					ownerContent,
				);
			}

			await expect(
				removeDaemonPidFile(pidFile, content, async () =>
					processIdentity(null, "current-owner"),
				),
			).rejects.toThrow("cannot be safely recovered");

			expect(await fs.readFile(pidFile, "utf8")).toBe(content);
		});
	}

	test("refuses to signal a matching identity owned by another user", async () => {
		const record = pidRecord();
		record.process.uid = ownerUid + 1;
		const original = await writePidRecord(pidFile, record);
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			kill: (_pid, signal) => {
				signals.push(signal);
			},
			inspectProcess: async () => ({
				...processIdentity(record.instanceId),
				uid: ownerUid + 1,
			}),
		};

		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"is not owned by the current user",
		);

		expect(signals).toEqual([]);
		expect(await fs.readFile(pidFile, "utf8")).toBe(original);
	});

	test("propagates a stop signal error and keeps the pid record", async () => {
		const original = await writePidRecord(pidFile);
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => processIdentity("0123456789abcdef"),
			kill: (_pid, signal) => {
				if (signal === "SIGTERM") throw processError("EPERM");
			},
		};

		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"EPERM",
		);
		expect(await fs.readFile(pidFile, "utf8")).toBe(original);
	});

	test("removes the same pid record only after graceful process exit", async () => {
		await writePidRecord(pidFile);
		let running = true;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () =>
				running ? processIdentity("0123456789abcdef") : null,
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === "SIGTERM") running = false;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("does not delete or signal a new daemon when the pid file changes during stop", async () => {
		await writePidRecord(pidFile);
		const replacement = pidRecord(5252, "abcdef0123456789", "linux-start-300");
		const replacementContent = JSON.stringify(replacement);
		let oldRunning = true;
		const signals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async (pid) => {
				if (pid === replacement.pid) {
					return processIdentity(
						replacement.instanceId,
						replacement.process.startTime,
					);
				}
				return oldRunning ? processIdentity("0123456789abcdef") : null;
			},
			kill: (pid, signal) => {
				signals.push({ pid, signal });
				if (pid === 4242 && signal === "SIGTERM") oldRunning = false;
			},
			wait: async () => {
				await fs.writeFile(pidFile, replacementContent, "utf8");
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
		expect(await fs.readFile(pidFile, "utf8")).toBe(replacementContent);
	});

	test("revalidates the daemon identity before forced termination", async () => {
		await writePidRecord(pidFile);
		let clock = -6000;
		let inspectionCount = 0;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => {
				inspectionCount += 1;
				if (inspectionCount === 1) {
					return processIdentity("0123456789abcdef");
				}
				return processIdentity("fedcba9876543210", "linux-start-200");
			},
			kill: (_pid, signal) => {
				signals.push(signal);
			},
			now: () => {
				clock += 6000;
				return clock;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("verifies forced termination before removing the pid record", async () => {
		await writePidRecord(pidFile);
		let running = true;
		let clock = -6000;
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () =>
				running ? processIdentity("0123456789abcdef") : null,
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === "SIGKILL") running = false;
			},
			now: () => {
				clock += 6000;
				return clock;
			},
		};

		await stopDaemonByPidFile(pidFile, control);

		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("propagates a force-kill error without deleting the pid record", async () => {
		const original = await writePidRecord(pidFile);
		let clock = -6000;
		const control: DaemonProcessControl = {
			...unusedControl(),
			inspectProcess: async () => processIdentity("0123456789abcdef"),
			kill: (_pid, signal) => {
				if (signal === "SIGKILL") throw processError("EPERM");
			},
			now: () => {
				clock += 6000;
				return clock;
			},
		};

		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"EPERM",
		);
		expect(await fs.readFile(pidFile, "utf8")).toBe(original);
	});
});

describe("daemon PID identity lifecycle", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobvibe-identity-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("writes, verifies, and compare-deletes the current Bun process identity", async () => {
		if (process.platform !== "darwin" && process.platform !== "linux") return;

		const pidFile = path.join(tempDir, "daemon.pid");
		const manager = new DaemonManager({ pidFile } as CliConfig);

		await manager.writePidFile(process.pid);
		expect(await manager.getPid()).toBe(process.pid);

		await manager.removePidFile();

		await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
		expect(
			(await fs.readdir(tempDir)).filter((entry) => entry.includes("identity")),
		).toEqual([]);
	});
});

describe("Darwin daemon identity inspection", () => {
	test("treats only a missing ps process as missing", async () => {
		let lsofCalled = false;

		await expect(
			inspectDarwinProcess(4242, {
				runPs: async () => null,
				runLsof: async () => {
					lsofCalled = true;
					throw new Error("lsof should not run");
				},
			}),
		).resolves.toBeNull();
		expect(lsofCalled).toBe(false);
	});

	test("fails closed when ps sees the process but lsof cannot inspect its identity", async () => {
		await expect(
			inspectDarwinProcess(4242, {
				runPs: async () => "501 Wed Jul 16 13:49:58 2026\n",
				runLsof: async () => null,
			}),
		).rejects.toThrow("open files");
	});
});

describe("Windows daemon identity inspection", () => {
	test("parses owner, creation time, and quoted non-ASCII command paths", async () => {
		const identity = await inspectWindowsProcess(4242, {
			runPowerShell: async () =>
				JSON.stringify({
					ownerSid: "S-1-5-21-111-222-333-1001",
					startTime: "2026-07-16T12:34:56.1234567Z",
					commandLine:
						'"C:\\Program Files\\Mobvibe 用户\\mobvibe.exe" start --foreground',
				}),
		});

		expect(identity).toEqual({
			platform: "win32",
			uid: "S-1-5-21-111-222-333-1001",
			startTime: "2026-07-16T12:34:56.1234567Z",
			instanceId: null,
			commandLine: [
				"C:\\Program Files\\Mobvibe 用户\\mobvibe.exe",
				"start",
				"--foreground",
			],
		});
	});

	test("writes and verifies a Windows process record without POSIX uid or lsof", async () => {
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "mobvibe-windows-identity-"),
		);
		const pidFile = path.join(tempDir, "daemon.pid");
		const identity: DaemonProcessIdentity = {
			platform: "win32",
			uid: "S-1-5-21-111-222-333-1001",
			startTime: "2026-07-16T12:34:56.1234567Z",
			instanceId: null,
			commandLine: ["mobvibe.exe", "start", "--foreground"],
		};
		const control: DaemonProcessControl = {
			...unusedControl(),
			currentUid: () => "S-1-5-21-111-222-333-1001",
			inspectProcess: async () => identity,
		};
		const manager = new DaemonManager({ pidFile } as CliConfig, control);

		try {
			await manager.writePidFile(process.pid);
			expect(await manager.getPid()).toBe(process.pid);
			await manager.removePidFile();
			await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
