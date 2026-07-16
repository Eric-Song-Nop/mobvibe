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
	inspectDarwinProcess,
	stopDaemonByPidFile,
} from "../daemon.js";

const processError = (code: string): NodeJS.ErrnoException =>
	Object.assign(new Error(code), { code });

const ownerUid = process.getuid?.() ?? 1000;

const processIdentity = (
	instanceId: string,
	startTime = "linux-start-100",
): DaemonProcessIdentity => ({
	platform: "linux",
	uid: ownerUid,
	startTime,
	instanceId,
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

	test("fails closed for a legacy PID-only file", async () => {
		await fs.writeFile(pidFile, "4242");
		const signals: Array<NodeJS.Signals | 0> = [];
		let clock = -6000;
		const control: DaemonProcessControl = {
			...unusedControl(),
			kill: (_pid, signal) => {
				signals.push(signal);
				if (signal === 0 && signals.includes("SIGKILL")) {
					throw processError("ESRCH");
				}
			},
			now: () => {
				clock += 6000;
				return clock;
			},
		};

		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"legacy daemon PID file cannot be verified",
		);

		expect(signals).toEqual([]);
		expect(await fs.readFile(pidFile, "utf8")).toBe("4242");
	});

	test("does not signal or delete a reused PID with a different OS identity", async () => {
		const original = await writePidRecord(pidFile);
		const signals: Array<NodeJS.Signals | 0> = [];
		const control: DaemonProcessControl = {
			...unusedControl(),
			kill: (_pid, signal) => {
				signals.push(signal);
			},
			inspectProcess: async () =>
				processIdentity("fedcba9876543210", "linux-start-200"),
		};

		await expect(stopDaemonByPidFile(pidFile, control)).rejects.toThrow(
			"identity no longer matches",
		);

		expect(signals).toEqual([]);
		expect(await fs.readFile(pidFile, "utf8")).toBe(original);
	});

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
		const original = await writePidRecord(pidFile);
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
		expect(await fs.readFile(pidFile, "utf8")).toBe(original);
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
