import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CliConfig } from "../../config.js";

const spawnMock = mock(() => ({
	pid: 4321,
	unref: mock(() => {}),
}));
const mkdirMock = mock(() => Promise.resolve());
const readFileMock = mock(() => Promise.reject(new Error("missing")));
const unlinkMock = mock(() => Promise.resolve());
const readdirMock = mock(() => Promise.resolve([]));
const openCloseMock = mock(() => Promise.resolve());
const openMock = mock(() =>
	Promise.resolve({
		fd: 123,
		close: openCloseMock,
	}),
);
const initCryptoMock = mock(() => Promise.resolve());
const base64ToUint8Mock = mock(() => new Uint8Array([1, 2, 3, 4]));
const getMasterSecretMock = mock(() => Promise.resolve("base64-secret"));

const cryptoConstructorCalls: Array<{
	masterSecret: Uint8Array;
	options?: { contentEncryptionEnabled?: boolean };
}> = [];
const socketClientConstructorCalls: Array<{
	config: CliConfig;
	sessionManager: unknown;
	cryptoService: unknown;
}> = [];

let socketConnectError: Error | null = null;

mock.module("node:child_process", () => ({
	spawn: spawnMock,
}));

mock.module("node:fs/promises", () => ({
	default: {
		mkdir: mkdirMock,
		readFile: readFileMock,
		unlink: unlinkMock,
		readdir: readdirMock,
		open: openMock,
	},
	mkdir: mkdirMock,
	readFile: readFileMock,
	unlink: unlinkMock,
	readdir: readdirMock,
	open: openMock,
}));

mock.module("@mobvibe/shared", () => ({
	initCrypto: initCryptoMock,
	base64ToUint8: base64ToUint8Mock,
}));

mock.module("../../auth/credentials.js", () => ({
	getMasterSecret: getMasterSecretMock,
}));

mock.module("../../lib/logger.js", () => ({
	logger: {
		info: mock(() => {}),
		debug: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
	},
}));

mock.module("../../e2ee/crypto-service.js", () => ({
	CliCryptoService: class MockCliCryptoService {
		authKeyPair = {
			publicKey: new Uint8Array(32),
			secretKey: new Uint8Array(64),
		};

		constructor(
			masterSecret: Uint8Array,
			options?: { contentEncryptionEnabled?: boolean },
		) {
			cryptoConstructorCalls.push({ masterSecret, options });
		}

		encryptEvent(event: unknown) {
			return event;
		}

		decryptRpcPayload(_sessionId: string, data: unknown) {
			return data;
		}

		getWrappedDek() {
			return null;
		}
	},
}));

mock.module("../socket-client.js", () => ({
	SocketClient: class MockSocketClient {
		constructor(args: {
			config: CliConfig;
			sessionManager: unknown;
			cryptoService: unknown;
		}) {
			socketClientConstructorCalls.push(args);
		}

		connect() {
			if (socketConnectError) {
				throw socketConnectError;
			}
		}

		disconnect() {}
	},
}));

const { DaemonManager } = await import("../daemon.js");

const createConfig = (): CliConfig => ({
	gatewayUrl: "http://localhost:3005",
	clientName: "test-client",
	clientVersion: "1.0.0",
	acpBackends: [
		{
			id: "backend-1",
			label: "Claude",
			command: "claude",
			args: [],
		},
	],
	registryAgents: [],
	homePath: "/tmp/mobvibe-test",
	logPath: "/tmp/mobvibe-test/logs",
	pidFile: "/tmp/mobvibe-test/daemon.pid",
	walDbPath: "/tmp/mobvibe-test/events.db",
	machineId: "machine-1",
	hostname: "host-1",
	platform: "darwin",
	compaction: {
		enabled: false,
		ackedEventRetentionDays: 7,
		keepLatestRevisionsCount: 2,
		runOnStartup: false,
		runIntervalHours: 24,
		minEventsToKeep: 1000,
	},
	consolidation: {
		enabled: false,
	},
	worktreeBaseDir: "/tmp/mobvibe-test/worktrees",
});

type StartForegroundHarness = {
	start: (options?: {
		foreground?: boolean;
		noE2ee?: boolean;
	}) => Promise<void>;
	getPid: ReturnType<typeof mock>;
	ensureHomeDirectory: ReturnType<typeof mock>;
	runForeground: ReturnType<typeof mock>;
};

type StartBackgroundHarness = {
	start: (options?: {
		foreground?: boolean;
		noE2ee?: boolean;
	}) => Promise<void>;
	getPid: ReturnType<typeof mock>;
	ensureHomeDirectory: ReturnType<typeof mock>;
	spawnBackground: ReturnType<typeof mock>;
};

type ForegroundHarness = {
	runForeground: (options?: { noE2ee?: boolean }) => Promise<void>;
	writePidFile: ReturnType<typeof mock>;
};

type SpawnBackgroundHarness = {
	spawnBackground: (options?: { noE2ee?: boolean }) => Promise<void>;
};

describe("DaemonManager no-e2ee", () => {
	const originalArgv = [...process.argv];
	const originalProcessOn = process.on;
	const originalConsoleLog = console.log;

	beforeEach(() => {
		spawnMock.mockClear();
		mkdirMock.mockClear();
		readFileMock.mockClear();
		unlinkMock.mockClear();
		readdirMock.mockClear();
		openMock.mockClear();
		openCloseMock.mockClear();
		initCryptoMock.mockClear();
		base64ToUint8Mock.mockClear();
		getMasterSecretMock.mockClear();
		cryptoConstructorCalls.length = 0;
		socketClientConstructorCalls.length = 0;
		socketConnectError = new Error("stop-after-connect");
		process.argv = [...originalArgv];
		process.on = mock(() => process) as typeof process.on;
		console.log = mock(() => {});
	});

	afterEach(() => {
		process.argv = [...originalArgv];
		process.on = originalProcessOn;
		console.log = originalConsoleLog;
	});

	test("start forwards noE2ee to foreground execution", async () => {
		const manager = new DaemonManager(
			createConfig(),
		) as unknown as StartForegroundHarness;
		manager.getPid = mock(() => Promise.resolve(null));
		manager.ensureHomeDirectory = mock(() => Promise.resolve());
		manager.runForeground = mock(() => Promise.resolve());

		await manager.start({ foreground: true, noE2ee: true });

		expect(manager.runForeground).toHaveBeenCalledWith({ noE2ee: true });
	});

	test("start forwards noE2ee to background execution", async () => {
		const manager = new DaemonManager(
			createConfig(),
		) as unknown as StartBackgroundHarness;
		manager.getPid = mock(() => Promise.resolve(null));
		manager.ensureHomeDirectory = mock(() => Promise.resolve());
		manager.spawnBackground = mock(() => Promise.resolve());

		await manager.start({ noE2ee: true });

		expect(manager.spawnBackground).toHaveBeenCalledWith({ noE2ee: true });
	});

	test("runForeground disables content encryption when noE2ee is true", async () => {
		const manager = new DaemonManager(
			createConfig(),
		) as unknown as ForegroundHarness;
		manager.writePidFile = mock(() => Promise.resolve());

		await expect(manager.runForeground({ noE2ee: true })).rejects.toThrow(
			"stop-after-connect",
		);

		expect(initCryptoMock).toHaveBeenCalled();
		expect(getMasterSecretMock).toHaveBeenCalled();
		expect(base64ToUint8Mock).toHaveBeenCalledWith("base64-secret");
		expect(cryptoConstructorCalls).toHaveLength(1);
		expect(cryptoConstructorCalls[0]).toEqual({
			masterSecret: new Uint8Array([1, 2, 3, 4]),
			options: { contentEncryptionEnabled: false },
		});
		expect(socketClientConstructorCalls).toHaveLength(1);
		expect(socketClientConstructorCalls[0]?.cryptoService).toBeDefined();
		expect(socketClientConstructorCalls[0]?.sessionManager).toBeDefined();
	});

	test("runForeground keeps content encryption enabled by default", async () => {
		const manager = new DaemonManager(
			createConfig(),
		) as unknown as ForegroundHarness;
		manager.writePidFile = mock(() => Promise.resolve());

		await expect(manager.runForeground()).rejects.toThrow("stop-after-connect");

		expect(cryptoConstructorCalls[0]?.options).toEqual({
			contentEncryptionEnabled: true,
		});
	});

	test("spawnBackground injects no-e2ee before foreground when requested", async () => {
		process.argv = ["/usr/local/bin/node", "dist/index.js", "start"];
		const manager = new DaemonManager(
			createConfig(),
		) as unknown as SpawnBackgroundHarness;

		await manager.spawnBackground({ noE2ee: true });

		expect(spawnMock).toHaveBeenCalledWith(
			process.execPath,
			["dist/index.js", "start", "--no-e2ee", "--foreground"],
			expect.objectContaining({
				env: expect.objectContaining({
					MOBVIBE_GATEWAY_URL: "http://localhost:3005",
				}),
			}),
		);
	});

	test("spawnBackground does not duplicate no-e2ee when argv already has it", async () => {
		process.argv = [
			"/usr/local/bin/node",
			"dist/index.js",
			"start",
			"--no-e2ee",
		];
		const manager = new DaemonManager(
			createConfig(),
		) as unknown as SpawnBackgroundHarness;

		await manager.spawnBackground({ noE2ee: true });

		const spawnCall = (spawnMock.mock.calls as unknown[][])[0];
		if (!spawnCall) {
			throw new Error("spawn should have been called");
		}
		const args = spawnCall[1] as unknown as string[];
		expect(args.filter((arg) => arg === "--no-e2ee")).toHaveLength(1);
		expect(args.at(-1)).toBe("--foreground");
	});
});
