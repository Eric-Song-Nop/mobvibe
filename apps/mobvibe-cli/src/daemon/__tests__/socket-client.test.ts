import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SessionEvent } from "@mobvibe/shared";
import type { CliConfig } from "../../config.js";

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

type GatewayConnectionHarness = {
	emit: (event: string, payload?: unknown) => boolean;
	socket?: {
		close: ReturnType<typeof mock>;
		readyState: number;
		send: ReturnType<typeof mock>;
	};
};

describe("SocketClient restore semantics", () => {
	let client: InstanceType<typeof SocketClient>;
	let gatewayConnection: GatewayConnectionHarness;
	let sentMessages: Array<{ payload: unknown; type: string }>;
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
		sentMessages = [];
		sessionEventListener = undefined;
		promptConnection = {
			prompt: mock(() => Promise.resolve({ stopReason: "end_turn" })),
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

		const clientHarness = client as unknown as {
			socket: GatewayConnectionHarness;
		};
		gatewayConnection = clientHarness.socket;
		gatewayConnection.socket = {
			close: mock(() => {}),
			readyState: WebSocket.OPEN,
			send: mock((raw: string) => {
				sentMessages.push(
					JSON.parse(raw) as { payload: unknown; type: string },
				);
			}),
		};
	});

	afterEach(() => {
		client.disconnect();
	});

	test("replays unacked events after reconnect using the active revision", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;

		await gatewayConnection.emit("connect", undefined);

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
		expect(sentMessages).toContainEqual(
			expect.objectContaining({
				type: "session:event",
				payload: expect.objectContaining({
					sessionId: "session-1",
					revision: 2,
					payload: { encrypted: true, originalSeq: 4 },
				}),
			}),
		);
	});

	test("does not replay events on the first successful connect", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 0;

		await gatewayConnection.emit("connect", undefined);

		expect(sessionManager.getUnackedEvents).not.toHaveBeenCalled();
		expect(
			sentMessages.find((message) => message.type === "session:event"),
		).toBe(undefined);
	});

	test("acks replayed events through the session manager", () => {
		gatewayConnection.emit("events:ack", {
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
		await gatewayConnection.emit("connect", undefined);

		expect(sessionManager.getUnackedEvents).toHaveBeenCalledTimes(1);
		expect(sessionManager.getUnackedEvents).toHaveBeenCalledWith(
			"session-1",
			2,
		);
	});

	test("forwards plaintext prompts through rpc:message:send", async () => {
		const prompt = [{ type: "text", text: "plain prompt" }] as const;

		await gatewayConnection.emit("rpc:message:send", {
			requestId: "req-1",
			params: {
				sessionId: "session-1",
				prompt,
			},
		});

		expect(cryptoService.decryptRpcPayload).toHaveBeenCalledWith(
			"session-1",
			prompt,
		);
		expect(promptConnection.prompt).toHaveBeenCalledWith("session-1", prompt);
		expect(sessionManager.touchSession).toHaveBeenCalledTimes(2);
		expect(sessionManager.recordTurnEnd).toHaveBeenCalledWith(
			"session-1",
			"end_turn",
		);
		expect(sentMessages).toContainEqual({
			type: "rpc:response",
			payload: {
				requestId: "req-1",
				result: { stopReason: "end_turn" },
			},
		});
	});

	test("emits plaintext session events when crypto service is pass-through", () => {
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
		expect(sentMessages).toContainEqual({
			type: "session:event",
			payload: event,
		});
	});
});
