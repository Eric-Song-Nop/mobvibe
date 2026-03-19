import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SessionEvent } from "@mobvibe/shared";
import type { CliConfig } from "../../config.js";

const socketHandlers = new Map<string, (...args: Array<unknown>) => void>();

const socketMock = {
	on: mock((event: string, handler: (...args: Array<unknown>) => void) => {
		socketHandlers.set(event, handler);
	}),
	emit: mock(() => {}),
	connect: mock(() => {}),
	disconnect: mock(() => {}),
	io: {
		opts: {
			extraHeaders: {},
		},
	},
};

mock.module("socket.io-client", () => ({
	io: mock((_url: string, _options: unknown) => socketMock),
}));

mock.module("../../lib/logger.js", () => ({
	logger: {
		info: mock(() => {}),
		debug: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
	},
}));

const { SocketClient } = await import("../socket-client.js");

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

const createSessionEvent = (
	overrides: Partial<SessionEvent> = {},
): SessionEvent => ({
	sessionId: "session-1",
	machineId: "machine-1",
	revision: 2,
	seq: 4,
	kind: "agent_message_chunk",
	createdAt: new Date().toISOString(),
	payload: {
		sessionId: "session-1",
		update: {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "replayed" },
		},
	},
	...overrides,
});

describe("SocketClient restore semantics", () => {
	let client: InstanceType<typeof SocketClient>;
	let sessionEventListener: ((event: SessionEvent) => void) | undefined;
	let promptConnection: {
		prompt: ReturnType<typeof mock>;
	};
	let sessionManager: {
		backfillDiscoveredWorkspaceRoots: ReturnType<typeof mock>;
		listAllSessions: ReturnType<typeof mock>;
		listSessions: ReturnType<typeof mock>;
		getSessionRevision: ReturnType<typeof mock>;
		getUnackedEvents: ReturnType<typeof mock>;
		ackEvents: ReturnType<typeof mock>;
		getSession: ReturnType<typeof mock>;
		touchSession: ReturnType<typeof mock>;
		recordTurnEnd: ReturnType<typeof mock>;
		closeSession: ReturnType<typeof mock>;
		setSessionConfigOption: ReturnType<typeof mock>;
		onSessionsChanged: ReturnType<typeof mock>;
		onSessionAttached: ReturnType<typeof mock>;
		onSessionDetached: ReturnType<typeof mock>;
		onPermissionRequest: ReturnType<typeof mock>;
		onPermissionResult: ReturnType<typeof mock>;
		onSessionEvent: ReturnType<typeof mock>;
	};
	let cryptoService: {
		authKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
		encryptEvent: ReturnType<typeof mock>;
		decryptRpcPayload: ReturnType<typeof mock>;
		getWrappedDek: ReturnType<typeof mock>;
	};

	beforeEach(() => {
		socketHandlers.clear();
		socketMock.on.mockClear();
		socketMock.emit.mockClear();
		socketMock.connect.mockClear();
		socketMock.disconnect.mockClear();
		socketMock.io.opts.extraHeaders = {};
		sessionEventListener = undefined;
		promptConnection = {
			prompt: mock(() =>
				Promise.resolve({
					stopReason: "end_turn",
					userMessageId: "agent-user-1",
				}),
			),
		};

		sessionManager = {
			backfillDiscoveredWorkspaceRoots: mock(() => Promise.resolve()),
			listAllSessions: mock(() => [{ sessionId: "session-1" }]),
			listSessions: mock(() => [{ sessionId: "session-1" }]),
			getSessionRevision: mock(() => 2),
			getUnackedEvents: mock(() => [createSessionEvent()]),
			ackEvents: mock(() => {}),
			getSession: mock(() => ({
				connection: promptConnection,
				cwd: "/tmp/project",
			})),
			touchSession: mock(() => {}),
			recordTurnEnd: mock(() => {}),
			closeSession: mock(() =>
				Promise.resolve({ sessionId: "session-1", isAttached: false }),
			),
			setSessionConfigOption: mock(() =>
				Promise.resolve({ sessionId: "session-1", configOptions: [] }),
			),
			onSessionsChanged: mock(() => () => {}),
			onSessionAttached: mock(() => () => {}),
			onSessionDetached: mock(() => () => {}),
			onPermissionRequest: mock(() => () => {}),
			onPermissionResult: mock(() => () => {}),
			onSessionEvent: mock((listener: (event: SessionEvent) => void) => {
				sessionEventListener = listener;
				return () => {
					sessionEventListener = undefined;
				};
			}),
		};

		cryptoService = {
			authKeyPair: {
				publicKey: new Uint8Array(32),
				secretKey: new Uint8Array(64),
			},
			encryptEvent: mock((event: SessionEvent) => ({
				...event,
				payload: { encrypted: true, originalSeq: event.seq },
			})),
			decryptRpcPayload: mock((_sessionId: string, data: unknown) => data),
			getWrappedDek: mock(() => null),
		};

		client = new SocketClient({
			config: createConfig(),
			sessionManager: sessionManager as never,
			cryptoService: cryptoService as never,
		});
	});

	afterEach(() => {
		client.disconnect();
	});

	test("replays unacked events after reconnect using the active revision", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();

		expect(sessionManager.getSessionRevision).toHaveBeenCalledWith("session-1");
		expect(sessionManager.getUnackedEvents).toHaveBeenCalledWith(
			"session-1",
			2,
		);
		expect(cryptoService.encryptEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				revision: 2,
				seq: 4,
			}),
		);
		expect(socketMock.emit).toHaveBeenCalledWith(
			"session:event",
			expect.objectContaining({
				sessionId: "session-1",
				revision: 2,
				payload: { encrypted: true, originalSeq: 4 },
			}),
		);
	});

	test("does not replay events on the first successful connect", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 0;

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();

		expect(sessionManager.getUnackedEvents).not.toHaveBeenCalled();
		expect(socketMock.emit).not.toHaveBeenCalledWith(
			"session:event",
			expect.anything(),
		);
	});

	test("acks replayed events through the session manager", () => {
		const ackHandler = socketHandlers.get("events:ack");
		if (!ackHandler) {
			throw new Error("events:ack handler not registered");
		}

		ackHandler({
			sessionId: "session-1",
			revision: 2,
			upToSeq: 4,
		});

		expect(sessionManager.ackEvents).toHaveBeenCalledWith("session-1", 2, 4);
	});

	test("skips replay for sessions without a current revision", async () => {
		sessionManager.listSessions.mockReturnValue([
			{ sessionId: "session-1" },
			{ sessionId: "session-2" },
		]);
		sessionManager.getSessionRevision.mockImplementation((sessionId: string) =>
			sessionId === "session-1" ? 2 : undefined,
		);

		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;
		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();

		expect(sessionManager.getUnackedEvents).toHaveBeenCalledTimes(1);
		expect(sessionManager.getUnackedEvents).toHaveBeenCalledWith(
			"session-1",
			2,
		);
	});

	test("forwards plaintext prompts through rpc:message:send", async () => {
		const prompt = [{ type: "text", text: "plain prompt" }] as const;
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-1",
			params: {
				sessionId: "session-1",
				prompt,
				messageId: "client-msg-1",
			},
		});

		expect(cryptoService.decryptRpcPayload).toHaveBeenCalledWith(
			"session-1",
			prompt,
		);
		expect(promptConnection.prompt).toHaveBeenCalledWith(
			"session-1",
			prompt,
			"client-msg-1",
		);
		expect(sessionManager.touchSession).toHaveBeenCalledTimes(2);
		expect(sessionManager.recordTurnEnd).toHaveBeenCalledWith(
			"session-1",
			"end_turn",
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-1",
			result: { stopReason: "end_turn", userMessageId: "agent-user-1" },
		});
	});

	test("routes rpc:session:close through sessionManager", async () => {
		const handler = socketHandlers.get("rpc:session:close");
		if (!handler) {
			throw new Error("rpc:session:close handler not registered");
		}

		await handler({
			requestId: "req-close-1",
			params: { sessionId: "session-1" },
		});

		expect(sessionManager.closeSession).toHaveBeenCalledWith("session-1");
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-close-1",
			result: { sessionId: "session-1", isAttached: false },
		});
	});

	test("routes rpc:session:config through sessionManager", async () => {
		const handler = socketHandlers.get("rpc:session:config");
		if (!handler) {
			throw new Error("rpc:session:config handler not registered");
		}

		await handler({
			requestId: "req-config-1",
			params: {
				sessionId: "session-1",
				configId: "mode",
				value: "plan",
			},
		});

		expect(sessionManager.setSessionConfigOption).toHaveBeenCalledWith({
			sessionId: "session-1",
			configId: "mode",
			value: "plan",
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-config-1",
			result: { sessionId: "session-1", configOptions: [] },
		});
	});

	test("emits plaintext session events when crypto service is pass-through", async () => {
		const event = createSessionEvent({
			payload: { text: "plain event" },
		});
		cryptoService.encryptEvent.mockImplementation(
			(input: SessionEvent) => input,
		);
		(client as unknown as { connected: boolean }).connected = true;
		if (!sessionEventListener) {
			throw new Error("session event listener not registered");
		}

		sessionEventListener(event);

		expect(cryptoService.encryptEvent).toHaveBeenCalledWith(event);
		expect(socketMock.emit).toHaveBeenCalledWith("session:event", event);
	});
});
