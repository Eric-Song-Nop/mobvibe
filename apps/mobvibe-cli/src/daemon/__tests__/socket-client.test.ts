import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentTeamSummary, SessionEvent } from "@mobvibe/shared";
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

const createdTeam: AgentTeamSummary = {
	agentTeamId: "team-1",
	machineId: "machine-1",
	title: "Team One",
	workspaceRootCwd: "/tmp/project",
	workspaceMode: "shared_workspace",
	leaderMemberId: "member-1",
	lifecycle: "pending",
	members: [],
	mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
	taskCounts: {
		todo: 0,
		inProgress: 0,
		blocked: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
	},
	createdAt: "2026-05-13T00:00:00.000Z",
	updatedAt: "2026-05-13T00:00:00.000Z",
};

const agentTeamStoreMock = {
	createAgentTeam: mock(() => ({ team: createdTeam })),
	listAgentTeams: mock(() => ({ teams: [createdTeam] })),
	getAgentTeam: mock(() => ({ team: createdTeam })),
	close: mock(() => {}),
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
		getSessionCapabilities: ReturnType<typeof mock>;
	};
	let sessionManager: {
		backfillDiscoveredWorkspaceRoots: ReturnType<typeof mock>;
		listAllSessions: ReturnType<typeof mock>;
		listSessions: ReturnType<typeof mock>;
		getSessionRevision: ReturnType<typeof mock>;
		listUnackedSessionRevisions: ReturnType<typeof mock>;
		getUnackedEvents: ReturnType<typeof mock>;
		ackEvents: ReturnType<typeof mock>;
		getMessageSendResult: ReturnType<typeof mock>;
		recordMessageSendResult: ReturnType<typeof mock>;
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
		socketHandlers.clear();
		socketMock.on.mockClear();
		socketMock.emit.mockClear();
		socketMock.connect.mockClear();
		socketMock.disconnect.mockClear();
		agentTeamStoreMock.createAgentTeam.mockClear();
		agentTeamStoreMock.listAgentTeams.mockClear();
		agentTeamStoreMock.getAgentTeam.mockClear();
		agentTeamStoreMock.close.mockClear();
		socketMock.io.opts.extraHeaders = {};
		sessionEventListener = undefined;
		promptConnection = {
			prompt: mock(() => Promise.resolve({ stopReason: "end_turn" })),
			getSessionCapabilities: mock(() => ({
				list: true,
				load: true,
				prompt: {
					image: false,
					audio: false,
					embeddedContext: false,
				},
			})),
		};

		sessionManager = {
			backfillDiscoveredWorkspaceRoots: mock(() => Promise.resolve()),
			listAllSessions: mock(() => [{ sessionId: "session-1" }]),
			listSessions: mock(() => [{ sessionId: "session-1" }]),
			getSessionRevision: mock(() => 2),
			listUnackedSessionRevisions: mock(() => [
				{ sessionId: "session-1", revision: 2 },
			]),
			getUnackedEvents: mock(() => [createSessionEvent()]),
			ackEvents: mock(() => {}),
			getMessageSendResult: mock(() => undefined),
			recordMessageSendResult: mock(() => {}),
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
			agentTeamStore: agentTeamStoreMock as never,
		});
	});

	afterEach(() => {
		client.disconnect();
	});

	test("replays unacked events after reconnect using the durable revision", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();

		expect(sessionManager.listUnackedSessionRevisions).toHaveBeenCalled();
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

	test("replays unacked events after a clean transport reconnect", async () => {
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const disconnectHandler = socketHandlers.get("disconnect");
		if (!connectHandler || !disconnectHandler) {
			throw new Error("socket lifecycle handlers not registered");
		}

		// A normal transport recovery can reconnect without any connect_error event.
		await connectHandler();
		sessionManager.getUnackedEvents.mockClear();
		socketMock.emit.mockClear();

		disconnectHandler("transport close");
		await connectHandler();

		expect(sessionManager.getUnackedEvents).toHaveBeenCalledWith(
			"session-1",
			2,
		);
		expect(socketMock.emit).toHaveBeenCalledWith(
			"session:event",
			expect.objectContaining({
				sessionId: "session-1",
				revision: 2,
				seq: 4,
			}),
		);
	});

	test("replays persisted events on the first successful connect", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 0;

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();

		expect(sessionManager.getUnackedEvents).toHaveBeenCalledWith(
			"session-1",
			2,
		);
		expect(socketMock.emit).toHaveBeenCalledWith(
			"session:event",
			expect.objectContaining({ sessionId: "session-1", revision: 2 }),
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

	test("skips replay when no durable revision has unacked events", async () => {
		sessionManager.listUnackedSessionRevisions.mockReturnValue([]);

		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;
		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();

		expect(sessionManager.getUnackedEvents).not.toHaveBeenCalled();
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
				messageId: "message-1",
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
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-1",
			result: { stopReason: "end_turn" },
		});
	});

	test("shares one prompt execution when a timed-out RPC is retried concurrently", async () => {
		let resolvePrompt: ((value: { stopReason: string }) => void) | undefined;
		promptConnection.prompt.mockImplementationOnce(
			() =>
				new Promise<{ stopReason: string }>((resolve) => {
					resolvePrompt = resolve;
				}),
		);
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}
		const params = {
			sessionId: "session-1",
			messageId: "message-concurrent",
			prompt: [{ type: "text", text: "run once" }],
		};

		const first = handler({ requestId: "req-concurrent-1", params });
		const second = handler({ requestId: "req-concurrent-2", params });
		await Promise.resolve();
		resolvePrompt?.({ stopReason: "end_turn" });
		await Promise.all([first, second]);

		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
		expect(sessionManager.recordTurnEnd).toHaveBeenCalledTimes(1);
		expect(sessionManager.recordMessageSendResult).toHaveBeenCalledTimes(1);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-concurrent-1",
			result: { stopReason: "end_turn" },
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-concurrent-2",
			result: { stopReason: "end_turn" },
		});
	});

	test("allows the same message to be retried after prompt execution fails", async () => {
		promptConnection.prompt.mockImplementationOnce(() =>
			Promise.reject(new Error("agent unavailable")),
		);
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}
		const params = {
			sessionId: "session-1",
			messageId: "message-retry-after-failure",
			prompt: [{ type: "text", text: "retry me" }],
		};

		await handler({ requestId: "req-failed", params });
		await handler({ requestId: "req-retry", params });

		expect(promptConnection.prompt).toHaveBeenCalledTimes(2);
		expect(sessionManager.recordMessageSendResult).toHaveBeenCalledTimes(1);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-retry",
			result: { stopReason: "end_turn" },
		});
	});

	test("serializes distinct messages for the same session", async () => {
		let resolveFirstPrompt:
			| ((value: { stopReason: string }) => void)
			| undefined;
		promptConnection.prompt.mockImplementationOnce(
			() =>
				new Promise<{ stopReason: string }>((resolve) => {
					resolveFirstPrompt = resolve;
				}),
		);
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		const first = handler({
			requestId: "req-serial-1",
			params: {
				sessionId: "session-1",
				messageId: "message-serial-1",
				prompt: [{ type: "text", text: "first" }],
			},
		});
		const second = handler({
			requestId: "req-serial-2",
			params: {
				sessionId: "session-1",
				messageId: "message-serial-2",
				prompt: [{ type: "text", text: "second" }],
			},
		});
		await Promise.resolve();

		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
		resolveFirstPrompt?.({ stopReason: "end_turn" });
		await Promise.all([first, second]);

		expect(promptConnection.prompt).toHaveBeenCalledTimes(2);
		expect(promptConnection.prompt.mock.calls[0]?.[1]).toEqual([
			{ type: "text", text: "first" },
		]);
		expect(promptConnection.prompt.mock.calls[1]?.[1]).toEqual([
			{ type: "text", text: "second" },
		]);
	});

	test("replays a durable completed result without prompting again", async () => {
		sessionManager.getMessageSendResult.mockReturnValueOnce({
			stopReason: "end_turn",
		});
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-durable-retry",
			params: {
				sessionId: "session-1",
				messageId: "message-completed",
				prompt: [{ type: "text", text: "must not run again" }],
			},
		});

		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-durable-retry",
			result: { stopReason: "end_turn" },
		});
	});

	test("rejects image prompts when backend image capability is disabled", async () => {
		const prompt = [
			{
				type: "image",
				data: "dGVzdA==",
				mimeType: "image/png",
			},
		] as const;
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-image-disabled",
			params: {
				sessionId: "session-1",
				messageId: "message-image-disabled",
				prompt,
			},
		});

		expect(promptConnection.prompt).not.toHaveBeenCalledWith(
			"session-1",
			prompt,
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-image-disabled",
			error: expect.objectContaining({
				code: "INTERNAL_ERROR",
				message: "Selected backend does not support image prompts",
			}),
		});
	});

	test("rejects oversized image prompts before ACP prompt()", async () => {
		promptConnection.getSessionCapabilities.mockReturnValue({
			list: true,
			load: true,
			prompt: {
				image: true,
				audio: false,
				embeddedContext: false,
			},
		});
		const prompt = [
			{
				type: "image",
				data: "A".repeat(700_000),
				mimeType: "image/png",
			},
		] as const;
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-image-too-large",
			params: {
				sessionId: "session-1",
				messageId: "message-image-too-large",
				prompt,
			},
		});

		expect(promptConnection.prompt).not.toHaveBeenCalledWith(
			"session-1",
			prompt,
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-image-too-large",
			error: expect.objectContaining({
				code: "INTERNAL_ERROR",
				message: "Each image must be 512 KiB or smaller",
			}),
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

	test("handles rpc:agent-team:create and emits changed projection", async () => {
		const handler = socketHandlers.get("rpc:agent-team:create");
		if (!handler) {
			throw new Error("rpc:agent-team:create handler not registered");
		}

		await handler({
			requestId: "team-create-1",
			params: {
				machineId: "machine-1",
				backendId: "backend-1",
				workspaceRootCwd: "/tmp/project",
				title: "Team One",
			},
		});

		expect(agentTeamStoreMock.createAgentTeam).toHaveBeenCalledWith({
			machineId: "machine-1",
			backendId: "backend-1",
			workspaceRootCwd: "/tmp/project",
			title: "Team One",
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "team-create-1",
			result: { team: createdTeam },
		});
		expect(socketMock.emit).toHaveBeenCalledWith("agent-teams:changed", {
			added: [createdTeam],
			updated: [],
			removed: [],
			machineId: "machine-1",
		});
	});

	test("handles rpc:agent-teams:list with requested machine context", async () => {
		const handler = socketHandlers.get("rpc:agent-teams:list");
		if (!handler) {
			throw new Error("rpc:agent-teams:list handler not registered");
		}

		await handler({
			requestId: "team-list-1",
			params: { machineId: "machine-1" },
		});

		expect(agentTeamStoreMock.listAgentTeams).toHaveBeenCalledWith({
			machineId: "machine-1",
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "team-list-1",
			result: { teams: [createdTeam] },
		});
	});

	test("handles rpc:agent-team:get not found as typed empty result", async () => {
		agentTeamStoreMock.getAgentTeam.mockReturnValueOnce({} as never);
		const handler = socketHandlers.get("rpc:agent-team:get");
		if (!handler) {
			throw new Error("rpc:agent-team:get handler not registered");
		}

		await handler({
			requestId: "team-get-1",
			params: { agentTeamId: "missing-team", machineId: "machine-1" },
		});

		expect(agentTeamStoreMock.getAgentTeam).toHaveBeenCalledWith({
			agentTeamId: "missing-team",
			machineId: "machine-1",
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "team-get-1",
			result: {},
		});
	});
});
