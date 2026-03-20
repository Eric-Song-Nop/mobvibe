import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CliConfig } from "../../config.js";
import { DaemonManager } from "../daemon.js";

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
	detectedBackends: [],
	registrySource: "fresh-cache",
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

type FakeCryptoService = {
	authKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
	encryptEvent: (event: unknown) => unknown;
	decryptRpcPayload: <T>(_sessionId: string, data: T) => T;
	getWrappedDek: (_sessionId: string) => null;
};

const createFakeCryptoService = (): FakeCryptoService => ({
	authKeyPair: {
		publicKey: new Uint8Array(32),
		secretKey: new Uint8Array(64),
	},
	encryptEvent: (event) => event,
	decryptRpcPayload: (_sessionId, data) => data,
	getWrappedDek: () => null,
});

class StartHarness extends DaemonManager {
	foregroundOptions?: { noE2ee?: boolean };
	backgroundOptions?: { noE2ee?: boolean };

	override async getPid(): Promise<number | null> {
		return null;
	}

	override async ensureHomeDirectory(): Promise<void> {}

	override async runForeground(options?: { noE2ee?: boolean }): Promise<void> {
		this.foregroundOptions = options;
	}

	protected override async spawnBackground(options?: {
		noE2ee?: boolean;
	}): Promise<void> {
		this.backgroundOptions = options;
	}
}

class RuntimeHarness extends DaemonManager {
	runtimeCryptoOptions?: { noE2ee?: boolean };
	writePidFileMock = mock((_pid: number) => Promise.resolve());
	fakeCryptoService = createFakeCryptoService();
	fakeSessionManager = {
		shutdown: mock(() => Promise.resolve()),
	};
	fakeSocketClient = {
		connect: mock(() => {
			throw new Error("stop-after-connect");
		}),
		disconnect: mock(() => {}),
	};

	override async writePidFile(pid: number): Promise<void> {
		await this.writePidFileMock(pid);
	}

	protected override async createRuntimeCryptoService(options?: {
		noE2ee?: boolean;
	}) {
		this.runtimeCryptoOptions = options;
		return this.fakeCryptoService as never;
	}

	protected override createSessionManager(_cryptoService: unknown) {
		return this.fakeSessionManager as never;
	}

	protected override createSocketClient(
		_sessionManager: unknown,
		_cryptoService: unknown,
	) {
		return this.fakeSocketClient as never;
	}
}

describe("DaemonManager no-e2ee", () => {
	let startHarness: StartHarness;
	let runtimeHarness: RuntimeHarness;

	beforeEach(() => {
		startHarness = new StartHarness(createConfig());
		runtimeHarness = new RuntimeHarness(createConfig());
	});

	test("start forwards noE2ee to foreground execution", async () => {
		await startHarness.start({ foreground: true, noE2ee: true });

		expect(startHarness.foregroundOptions).toEqual({ noE2ee: true });
		expect(startHarness.backgroundOptions).toBeUndefined();
	});

	test("start forwards noE2ee to background execution", async () => {
		await startHarness.start({ noE2ee: true });

		expect(startHarness.backgroundOptions).toEqual({ noE2ee: true });
		expect(startHarness.foregroundOptions).toBeUndefined();
	});

	test("runForeground disables content encryption when noE2ee is true", async () => {
		await expect(
			runtimeHarness.runForeground({ noE2ee: true }),
		).rejects.toThrow("stop-after-connect");

		expect(runtimeHarness.writePidFileMock).toHaveBeenCalled();
		expect(runtimeHarness.runtimeCryptoOptions).toEqual({ noE2ee: true });
		expect(runtimeHarness.fakeSocketClient.connect).toHaveBeenCalled();
	});

	test("runForeground keeps content encryption enabled by default", async () => {
		await expect(runtimeHarness.runForeground()).rejects.toThrow(
			"stop-after-connect",
		);

		expect(runtimeHarness.runtimeCryptoOptions).toBeUndefined();
		expect(runtimeHarness.fakeSocketClient.connect).toHaveBeenCalled();
	});
});
