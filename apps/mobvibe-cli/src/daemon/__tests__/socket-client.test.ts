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
		getUnackedEventsPage: ReturnType<typeof mock>;
		isSessionDeletionGuarded: ReturnType<typeof mock>;
		getSessionIncarnationGeneration: ReturnType<typeof mock>;
		ackEvents: ReturnType<typeof mock>;
		claimMessageSend: ReturnType<typeof mock>;
		completeMessageSend: ReturnType<typeof mock>;
		beginMessageSend: ReturnType<typeof mock>;
		endMessageSend: ReturnType<typeof mock>;
		getMessageSendResult: ReturnType<typeof mock>;
		recordMessageSendResult: ReturnType<typeof mock>;
		getSession: ReturnType<typeof mock>;
		getAgentCapabilities: ReturnType<typeof mock>;
		authenticateAgent: ReturnType<typeof mock>;
		logoutAgent: ReturnType<typeof mock>;
		loadSession: ReturnType<typeof mock>;
		resumeSession: ReturnType<typeof mock>;
		reloadSession: ReturnType<typeof mock>;
		setSessionConfigOption: ReturnType<typeof mock>;
		setSessionMode: ReturnType<typeof mock>;
		setSessionModel: ReturnType<typeof mock>;
		updateTitle: ReturnType<typeof mock>;
		cancelSession: ReturnType<typeof mock>;
		assertSessionCloseSupported: ReturnType<typeof mock>;
		assertSessionDeleteSupported: ReturnType<typeof mock>;
		closeSession: ReturnType<typeof mock>;
		deleteSession: ReturnType<typeof mock>;
		archiveSession: ReturnType<typeof mock>;
		bulkArchiveSessions: ReturnType<typeof mock>;
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
		contentEncryptionEnabled: boolean;
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
			getUnackedEventsPage: mock(
				(_sessionId: string, _revision: number, afterSeq: number) =>
					afterSeq === 0 ? [createSessionEvent()] : [],
			),
			isSessionDeletionGuarded: mock(() => false),
			getSessionIncarnationGeneration: mock(() => 0),
			ackEvents: mock(() => {}),
			claimMessageSend: mock(() => ({
				status: "claimed",
				claimId: "claim-1",
			})),
			completeMessageSend: mock(() => {}),
			beginMessageSend: mock(() => {}),
			endMessageSend: mock(() => {}),
			getMessageSendResult: mock(() => undefined),
			recordMessageSendResult: mock(() => {}),
			getSession: mock(() => ({
				connection: promptConnection,
				cwd: "/tmp/project",
			})),
			getAgentCapabilities: mock(() =>
				Promise.resolve({
					list: false,
					load: false,
					auth: {
						methods: [{ id: "browser", name: "Browser sign-in" }],
						logout: true,
					},
				}),
			),
			authenticateAgent: mock(() =>
				Promise.resolve({ list: false, load: false }),
			),
			logoutAgent: mock(() => Promise.resolve({ list: false, load: false })),
			loadSession: mock(() => Promise.resolve({ sessionId: "session-1" })),
			resumeSession: mock(() => Promise.resolve({ sessionId: "session-1" })),
			reloadSession: mock(() => Promise.resolve({ sessionId: "session-1" })),
			setSessionConfigOption: mock(() =>
				Promise.resolve({ sessionId: "session-1" }),
			),
			setSessionMode: mock(() => Promise.resolve({ sessionId: "session-1" })),
			setSessionModel: mock(() => Promise.resolve({ sessionId: "session-1" })),
			updateTitle: mock(() => ({ sessionId: "session-1" })),
			cancelSession: mock(() => Promise.resolve(true)),
			assertSessionCloseSupported: mock(() => {}),
			assertSessionDeleteSupported: mock(() => {}),
			closeSession: mock(() =>
				Promise.resolve({ sessionId: "session-1", isAttached: false }),
			),
			deleteSession: mock(() => Promise.resolve()),
			archiveSession: mock(() => Promise.resolve()),
			bulkArchiveSessions: mock(() => Promise.resolve({ archivedCount: 1 })),
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
			contentEncryptionEnabled: false,
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

	test("forwards protocol-native session config RPCs to SessionManager", async () => {
		const handler = socketHandlers.get("rpc:session:config");
		if (!handler) {
			throw new Error("rpc:session:config handler not registered");
		}
		const params = {
			sessionId: "session-1",
			configId: "auto-approve",
			type: "boolean",
			value: true,
			_meta: { requestSource: "webui" },
		} as const;

		await handler({ requestId: "req-config", params });

		expect(sessionManager.setSessionConfigOption).toHaveBeenCalledWith(
			"session-1",
			"auto-approve",
			true,
			{ requestSource: "webui" },
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-config",
			result: { sessionId: "session-1" },
		});
	});

	test("serves backend authentication capabilities over RPC", async () => {
		const handler = socketHandlers.get("rpc:agent:capabilities");
		if (!handler) throw new Error("Agent capabilities handler not registered");

		await handler({
			requestId: "req-agent-capabilities",
			params: { backendId: "backend-1" },
		});

		expect(sessionManager.getAgentCapabilities).toHaveBeenCalledWith(
			"backend-1",
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-agent-capabilities",
			result: {
				capabilities: {
					list: false,
					load: false,
					auth: {
						methods: [{ id: "browser", name: "Browser sign-in" }],
						logout: true,
					},
				},
			},
		});
	});

	test("forwards Agent authentication without credential payloads", async () => {
		const handler = socketHandlers.get("rpc:agent:authenticate");
		if (!handler) throw new Error("Agent authenticate handler not registered");

		await handler({
			requestId: "req-agent-authenticate",
			params: { backendId: "backend-1", methodId: "browser" },
		});

		expect(sessionManager.authenticateAgent).toHaveBeenCalledWith(
			"backend-1",
			"browser",
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-agent-authenticate",
			result: { capabilities: { list: false, load: false } },
		});
	});

	test("forwards Agent logout and returns the refreshed snapshot", async () => {
		const handler = socketHandlers.get("rpc:agent:logout");
		if (!handler) throw new Error("Agent logout handler not registered");

		await handler({
			requestId: "req-agent-logout",
			params: { backendId: "backend-1" },
		});

		expect(sessionManager.logoutAgent).toHaveBeenCalledWith("backend-1");
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-agent-logout",
			result: { capabilities: { list: false, load: false } },
		});
	});

	test("replays unacked events after reconnect using the durable revision", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();
		await (
			socketHandlers.get("cli:registered") as
				| ((info: { machineId: string }) => Promise<void>)
				| undefined
		)?.({ machineId: "machine-1" });

		expect(sessionManager.listUnackedSessionRevisions).toHaveBeenCalled();
		expect(sessionManager.getUnackedEventsPage).toHaveBeenCalledWith(
			"session-1",
			2,
			0,
			100,
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

	test("does not emit a replay page when deletion starts after the page read", async () => {
		let deletionStarted = false;
		sessionManager.isSessionDeletionGuarded.mockImplementation(
			() => deletionStarted,
		);
		sessionManager.getUnackedEventsPage.mockImplementationOnce(() => {
			const page = [createSessionEvent({ seq: 4 })];
			deletionStarted = true;
			return page;
		});

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();
		await (
			socketHandlers.get("cli:registered") as
				| ((info: { machineId: string }) => Promise<void>)
				| undefined
		)?.({ machineId: "machine-1" });

		expect(cryptoService.encryptEvent).not.toHaveBeenCalled();
		expect(socketMock.emit).not.toHaveBeenCalledWith(
			"session:event",
			expect.anything(),
		);
	});

	test("does not emit an old replay page after the session ID is reused", async () => {
		let incarnation = 0;
		sessionManager.getSessionIncarnationGeneration.mockImplementation(
			() => incarnation,
		);
		sessionManager.getUnackedEventsPage.mockImplementationOnce(() => {
			const oldPage = [createSessionEvent({ seq: 4 })];
			// Model a completed delete followed by authoritative session/new or
			// session/list reuse: the guard is clear, but the incarnation advanced.
			incarnation = 1;
			return oldPage;
		});

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();
		await (
			socketHandlers.get("cli:registered") as
				| ((info: { machineId: string }) => Promise<void>)
				| undefined
		)?.({ machineId: "machine-1" });

		expect(cryptoService.encryptEvent).not.toHaveBeenCalled();
		sessionEventListener?.(createSessionEvent({ seq: 5 }));
		expect(socketMock.emit).toHaveBeenCalledWith(
			"session:event",
			expect.objectContaining({ seq: 5 }),
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
		await (
			socketHandlers.get("cli:registered") as
				| ((info: { machineId: string }) => Promise<void>)
				| undefined
		)?.({ machineId: "machine-1" });
		sessionManager.getUnackedEventsPage.mockClear();
		socketMock.emit.mockClear();

		disconnectHandler("transport close");
		await connectHandler();
		await (
			socketHandlers.get("cli:registered") as
				| ((info: { machineId: string }) => Promise<void>)
				| undefined
		)?.({ machineId: "machine-1" });

		expect(sessionManager.getUnackedEventsPage).toHaveBeenCalledWith(
			"session-1",
			2,
			0,
			100,
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

	test("waits for registration confirmation before replaying persisted events", async () => {
		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 0;

		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();
		expect(sessionManager.getUnackedEventsPage).not.toHaveBeenCalled();
		expect(socketMock.emit).not.toHaveBeenCalledWith(
			"session:event",
			expect.anything(),
		);

		await (
			socketHandlers.get("cli:registered") as
				| ((info: { machineId: string }) => Promise<void>)
				| undefined
		)?.({ machineId: "machine-1" });

		expect(sessionManager.getUnackedEventsPage).toHaveBeenCalledWith(
			"session-1",
			2,
			0,
			100,
		);
		expect(socketMock.emit).toHaveBeenCalledWith(
			"session:event",
			expect.objectContaining({ sessionId: "session-1", revision: 2 }),
		);
	});

	test("buffers live events from transport connect until registration replay completes", async () => {
		sessionManager.getUnackedEventsPage.mockImplementation(
			(_sessionId: string, _revision: number, afterSeq: number) =>
				afterSeq === 0 ? [createSessionEvent({ seq: 1 })] : [],
		);
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!connectHandler || !registeredHandler || !sessionEventListener) {
			throw new Error("socket lifecycle handlers not registered");
		}

		await connectHandler();
		sessionEventListener(createSessionEvent({ seq: 2 }));

		expect(
			socketMock.emit.mock.calls.filter(
				(call) => (call as unknown[])[0] === "session:event",
			),
		).toHaveLength(0);

		await registeredHandler({ machineId: "machine-1" });

		const emittedSeqs = socketMock.emit.mock.calls
			.filter((call) => (call as unknown[])[0] === "session:event")
			.map((call) => ((call as unknown[])[1] as SessionEvent).seq);
		expect(emittedSeqs).toEqual([1, 2]);
	});

	test("does not flush pre-registration live events after registration fails", async () => {
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		const registrationErrorHandler = socketHandlers.get("cli:error");
		if (
			!connectHandler ||
			!registeredHandler ||
			!registrationErrorHandler ||
			!sessionEventListener
		) {
			throw new Error("socket lifecycle handlers not registered");
		}

		await connectHandler();
		sessionEventListener(createSessionEvent({ seq: 2 }));
		registrationErrorHandler({
			code: "REGISTRATION_ERROR",
			message: "registration failed",
		});
		await registeredHandler({ machineId: "machine-1" });

		expect(client.isConnected()).toBe(false);
		expect(
			socketMock.emit.mock.calls.filter(
				(call) => (call as unknown[])[0] === "session:event",
			),
		).toHaveLength(0);
	});

	test("discards the pre-registration buffer when its transport disconnects", async () => {
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		const disconnectHandler = socketHandlers.get("disconnect");
		if (
			!connectHandler ||
			!registeredHandler ||
			!disconnectHandler ||
			!sessionEventListener
		) {
			throw new Error("socket lifecycle handlers not registered");
		}

		await connectHandler();
		sessionEventListener(createSessionEvent({ seq: 2 }));
		disconnectHandler("transport close");
		await registeredHandler({ machineId: "machine-1" });

		expect(
			socketMock.emit.mock.calls.filter(
				(call) => (call as unknown[])[0] === "session:event",
			),
		).toHaveLength(0);
	});

	test("pages a large backlog and emits live events only after every older sequence", async () => {
		const backlog = Array.from({ length: 205 }, (_, index) =>
			createSessionEvent({ seq: index + 1 }),
		);
		sessionManager.getUnackedEventsPage.mockImplementation(
			(
				_sessionId: string,
				_revision: number,
				afterSeq: number,
				limit: number,
			) => backlog.filter((event) => event.seq > afterSeq).slice(0, limit),
		);
		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!registeredHandler) {
			throw new Error("cli:registered handler not registered");
		}

		const registration = registeredHandler({ machineId: "machine-1" });
		const replayedCount = () =>
			socketMock.emit.mock.calls.filter(
				(call) => (call as unknown[])[0] === "session:event",
			).length;

		expect(replayedCount()).toBe(100);
		sessionEventListener?.(createSessionEvent({ seq: 206 }));
		expect(replayedCount()).toBe(100);
		await registration;
		expect(replayedCount()).toBe(206);
		const emittedSeqs = socketMock.emit.mock.calls
			.filter((call) => (call as unknown[])[0] === "session:event")
			.map((call) => ((call as unknown[])[1] as SessionEvent).seq);
		expect(emittedSeqs).toEqual(
			Array.from({ length: 206 }, (_, index) => index + 1),
		);
		expect(sessionManager.getUnackedEventsPage.mock.calls).toEqual([
			["session-1", 2, 0, 100],
			["session-1", 2, 100, 100],
			["session-1", 2, 200, 100],
		]);
	});

	test("flushes only buffered events from the current session incarnation", async () => {
		let incarnation = 0;
		const backlog = Array.from({ length: 100 }, (_, index) =>
			createSessionEvent({ seq: index + 1 }),
		);
		sessionManager.getSessionIncarnationGeneration.mockImplementation(
			() => incarnation,
		);
		sessionManager.getUnackedEventsPage.mockImplementation(
			(
				_sessionId: string,
				_revision: number,
				afterSeq: number,
				limit: number,
			) => backlog.filter((event) => event.seq > afterSeq).slice(0, limit),
		);
		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!registeredHandler || !sessionEventListener) {
			throw new Error("replay handlers not registered");
		}

		const registration = registeredHandler({ machineId: "machine-1" });
		sessionEventListener(
			createSessionEvent({ seq: 150, kind: "agent_thought_chunk" }),
		);
		incarnation = 1;
		sessionEventListener(
			createSessionEvent({ seq: 1, kind: "terminal_output" }),
		);
		await registration;

		const emittedEvents = socketMock.emit.mock.calls
			.filter((call) => (call as unknown[])[0] === "session:event")
			.map((call) => (call as unknown[])[1] as SessionEvent);
		expect(
			emittedEvents.some((event) => event.kind === "agent_thought_chunk"),
		).toBe(false);
		expect(
			emittedEvents.some(
				(event) => event.kind === "terminal_output" && event.seq === 1,
			),
		).toBe(true);
	});

	test("cancels a stale replay without emitting a buffered live event", async () => {
		const backlog = Array.from({ length: 205 }, (_, index) =>
			createSessionEvent({ seq: index + 1 }),
		);
		sessionManager.getUnackedEventsPage.mockImplementation(
			(
				_sessionId: string,
				_revision: number,
				afterSeq: number,
				limit: number,
			) => backlog.filter((event) => event.seq > afterSeq).slice(0, limit),
		);
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const disconnectHandler = socketHandlers.get("disconnect");
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!connectHandler || !disconnectHandler || !registeredHandler) {
			throw new Error("socket lifecycle handlers not registered");
		}

		await connectHandler();
		const staleRegistration = registeredHandler({ machineId: "machine-1" });
		sessionEventListener?.(createSessionEvent({ seq: 206 }));
		disconnectHandler("transport close");
		await connectHandler();
		await staleRegistration;

		const replayedCount = socketMock.emit.mock.calls.filter(
			(call) => (call as unknown[])[0] === "session:event",
		).length;
		expect(replayedCount).toBe(100);
	});

	test("reconnects for durable replay when the live-event replay buffer fills", async () => {
		const backlog = Array.from({ length: 205 }, (_, index) =>
			createSessionEvent({ seq: index + 1 }),
		);
		sessionManager.getUnackedEventsPage.mockImplementation(
			(
				_sessionId: string,
				_revision: number,
				afterSeq: number,
				limit: number,
			) => backlog.filter((event) => event.seq > afterSeq).slice(0, limit),
		);
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!connectHandler || !registeredHandler || !sessionEventListener) {
			throw new Error("socket lifecycle handlers not registered");
		}

		await connectHandler();
		const registration = registeredHandler({ machineId: "machine-1" });
		for (let index = 0; index <= 1000; index += 1) {
			sessionEventListener(createSessionEvent({ seq: 206 + index }));
		}
		await registration;

		expect(socketMock.disconnect).toHaveBeenCalledTimes(1);
		expect(socketMock.connect).toHaveBeenCalledTimes(1);
		expect(
			(client as unknown as { pendingLiveEvents: SessionEvent[] })
				.pendingLiveEvents,
		).toHaveLength(0);
		const replayedCount = socketMock.emit.mock.calls.filter(
			(call) => (call as unknown[])[0] === "session:event",
		).length;
		expect(replayedCount).toBe(100);
	});

	test("reconnects when buffered live-event payloads exceed the byte budget", async () => {
		const backlog = Array.from({ length: 205 }, (_, index) =>
			createSessionEvent({ seq: index + 1 }),
		);
		sessionManager.getUnackedEventsPage.mockImplementation(
			(
				_sessionId: string,
				_revision: number,
				afterSeq: number,
				limit: number,
			) => backlog.filter((event) => event.seq > afterSeq).slice(0, limit),
		);
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!connectHandler || !registeredHandler || !sessionEventListener) {
			throw new Error("socket lifecycle handlers not registered");
		}

		await connectHandler();
		const registration = registeredHandler({ machineId: "machine-1" });
		const largeText = "x".repeat(5 * 1024 * 1024);
		sessionEventListener(
			createSessionEvent({ seq: 206, payload: { text: largeText } }),
		);
		sessionEventListener(
			createSessionEvent({ seq: 207, payload: { text: largeText } }),
		);
		await registration;

		expect(socketMock.disconnect).toHaveBeenCalledTimes(1);
		expect(socketMock.connect).toHaveBeenCalledTimes(1);
		expect(
			(
				client as unknown as {
					pendingLiveEvents: SessionEvent[];
					pendingLiveEventBytes: number;
				}
			).pendingLiveEvents,
		).toHaveLength(0);
		expect(
			(client as unknown as { pendingLiveEventBytes: number })
				.pendingLiveEventBytes,
		).toBe(0);
		const replayedCount = socketMock.emit.mock.calls.filter(
			(call) => (call as unknown[])[0] === "session:event",
		).length;
		expect(replayedCount).toBe(100);
	});

	test("reconnects when a buffered live event cannot be serialized", async () => {
		const backlog = Array.from({ length: 205 }, (_, index) =>
			createSessionEvent({ seq: index + 1 }),
		);
		sessionManager.getUnackedEventsPage.mockImplementation(
			(
				_sessionId: string,
				_revision: number,
				afterSeq: number,
				limit: number,
			) => backlog.filter((event) => event.seq > afterSeq).slice(0, limit),
		);
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!connectHandler || !registeredHandler || !sessionEventListener) {
			throw new Error("socket lifecycle handlers not registered");
		}

		await connectHandler();
		const registration = registeredHandler({ machineId: "machine-1" });
		const cyclicPayload: { self?: unknown } = {};
		cyclicPayload.self = cyclicPayload;
		sessionEventListener(
			createSessionEvent({ seq: 206, payload: cyclicPayload }),
		);
		await registration;

		expect(socketMock.disconnect).toHaveBeenCalledTimes(1);
		expect(socketMock.connect).toHaveBeenCalledTimes(1);
		expect(
			(client as unknown as { pendingLiveEvents: SessionEvent[] })
				.pendingLiveEvents,
		).toHaveLength(0);
		const replayedCount = socketMock.emit.mock.calls.filter(
			(call) => (call as unknown[])[0] === "session:event",
		).length;
		expect(replayedCount).toBe(100);
	});

	test("keeps the replay barrier active while flushing buffered events", async () => {
		const backlog = Array.from({ length: 101 }, (_, index) =>
			createSessionEvent({ seq: index + 1 }),
		);
		sessionManager.getUnackedEventsPage.mockImplementation(
			(
				_sessionId: string,
				_revision: number,
				afterSeq: number,
				limit: number,
			) => backlog.filter((event) => event.seq > afterSeq).slice(0, limit),
		);
		const connectHandler = socketHandlers.get("connect") as
			| (() => Promise<void>)
			| undefined;
		const registeredHandler = socketHandlers.get("cli:registered") as
			| ((info: { machineId: string }) => Promise<void>)
			| undefined;
		if (!connectHandler || !registeredHandler || !sessionEventListener) {
			throw new Error("socket lifecycle handlers not registered");
		}
		let injectedDuringFlush = false;
		cryptoService.encryptEvent.mockImplementation((event: SessionEvent) => {
			if (event.seq === 102 && !injectedDuringFlush) {
				injectedDuringFlush = true;
				sessionEventListener?.(createSessionEvent({ seq: 103 }));
			}
			return {
				...event,
				payload: { encrypted: true, originalSeq: event.seq },
			};
		});

		await connectHandler();
		const registration = registeredHandler({ machineId: "machine-1" });
		sessionEventListener(createSessionEvent({ seq: 102 }));
		await registration;

		const emittedSeqs = socketMock.emit.mock.calls
			.filter((call) => (call as unknown[])[0] === "session:event")
			.map((call) => ((call as unknown[])[1] as SessionEvent).seq);
		expect(emittedSeqs).toEqual(
			Array.from({ length: 103 }, (_, index) => index + 1),
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

		expect(sessionManager.ackEvents).toHaveBeenCalledWith(
			"session-1",
			2,
			4,
			undefined,
		);

		ackHandler({
			sessionId: "session-1",
			incarnationGeneration: 7,
			revision: 2,
			upToSeq: 5,
		});
		expect(sessionManager.ackEvents).toHaveBeenLastCalledWith(
			"session-1",
			2,
			5,
			7,
		);
	});

	test("skips replay when no durable revision has unacked events", async () => {
		sessionManager.listUnackedSessionRevisions.mockReturnValue([]);

		(client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;
		await (
			socketHandlers.get("connect") as (() => Promise<void>) | undefined
		)?.();
		await (
			socketHandlers.get("cli:registered") as
				| ((info: { machineId: string }) => Promise<void>)
				| undefined
		)?.({ machineId: "machine-1" });

		expect(sessionManager.getUnackedEventsPage).not.toHaveBeenCalled();
	});

	test("forwards plaintext prompts through rpc:message:send", async () => {
		promptConnection.prompt.mockResolvedValueOnce({
			stopReason: "end_turn",
			usage: {
				totalTokens: 120,
				inputTokens: 80,
				outputTokens: 40,
				thoughtTokens: null,
				cachedReadTokens: 10,
			},
		});
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
		expect(sessionManager.beginMessageSend).toHaveBeenCalledWith(
			"session-1",
			"message-1",
		);
		expect(sessionManager.endMessageSend).toHaveBeenCalledWith(
			"session-1",
			"message-1",
		);
		expect(sessionManager.touchSession).toHaveBeenCalledTimes(2);
		expect(sessionManager.completeMessageSend).toHaveBeenCalledWith(
			"session-1",
			"message-1",
			"claim-1",
			"end_turn",
			{
				totalTokens: 120,
				inputTokens: 80,
				outputTokens: 40,
				cachedReadTokens: 10,
			},
		);
		expect(sessionManager.recordTurnEnd).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-1",
			result: {
				stopReason: "end_turn",
				usage: {
					totalTokens: 120,
					inputTokens: 80,
					outputTokens: 40,
					cachedReadTokens: 10,
				},
			},
		});
	});

	test("omits an invalid agent usage snapshot without failing the prompt", async () => {
		promptConnection.prompt.mockResolvedValueOnce({
			stopReason: "end_turn",
			usage: { totalTokens: -1, inputTokens: 1, outputTokens: 0 },
		});
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) throw new Error("rpc:message:send handler not registered");

		await handler({
			requestId: "req-invalid-usage",
			params: {
				sessionId: "session-1",
				messageId: "message-invalid-usage",
				prompt: [{ type: "text", text: "prompt" }],
			},
		});

		expect(sessionManager.completeMessageSend).toHaveBeenCalledWith(
			"session-1",
			"message-invalid-usage",
			"claim-1",
			"end_turn",
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-invalid-usage",
			result: { stopReason: "end_turn" },
		});
	});

	test("rejects plaintext prompts when content encryption is required", async () => {
		cryptoService.contentEncryptionEnabled = true;
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-plaintext-downgrade",
			params: {
				sessionId: "session-1",
				messageId: "message-plaintext-downgrade",
				prompt: [{ type: "text", text: "must stay encrypted" }],
			},
		});

		expect(cryptoService.decryptRpcPayload).not.toHaveBeenCalled();
		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(sessionManager.claimMessageSend).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-plaintext-downgrade",
			error: expect.objectContaining({
				code: "REQUEST_VALIDATION_FAILED",
				retryable: false,
				status: 400,
			}),
		});
	});

	test("uses the RPC request id when an old gateway omits messageId", async () => {
		const prompt = [{ type: "text", text: "legacy prompt" }] as const;
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-from-old-gateway",
			params: {
				sessionId: "session-1",
				prompt,
			},
		});

		expect(sessionManager.claimMessageSend).toHaveBeenCalledWith(
			"session-1",
			"legacy-rpc:req-from-old-gateway",
		);
		expect(sessionManager.completeMessageSend).toHaveBeenCalledWith(
			"session-1",
			"legacy-rpc:req-from-old-gateway",
			"claim-1",
			"end_turn",
		);
		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
	});

	test("uses the RPC request id when an old gateway sends a blank messageId", async () => {
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-with-blank-message-id",
			params: {
				sessionId: "session-1",
				messageId: "  ",
				prompt: [{ type: "text", text: "legacy prompt" }],
			},
		});

		expect(sessionManager.claimMessageSend).toHaveBeenCalledWith(
			"session-1",
			"legacy-rpc:req-with-blank-message-id",
		);
		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
	});

	test("advertises durable message idempotency and revision pinning", () => {
		(
			client as unknown as {
				register: () => void;
			}
		).register();

		expect(socketMock.emit).toHaveBeenCalledWith(
			"cli:register",
			expect.objectContaining({
				protocolCapabilities: {
					messageIdempotency: true,
					messageRevisionPinning: true,
				},
			}),
		);
	});

	test("rejects a stale no-E2EE revision before decrypting or claiming", async () => {
		sessionManager.getSessionRevision.mockReturnValue(3);
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-stale-plaintext-revision",
			params: {
				sessionId: "session-1",
				messageId: "message-stale-plaintext-revision",
				expectedRevision: 2,
				prompt: [{ type: "text", text: "must not run" }],
			},
		});

		expect(cryptoService.decryptRpcPayload).not.toHaveBeenCalled();
		expect(sessionManager.claimMessageSend).not.toHaveBeenCalled();
		expect(sessionManager.beginMessageSend).not.toHaveBeenCalled();
		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-stale-plaintext-revision",
			error: expect.objectContaining({
				code: "SESSION_NOT_READY",
				retryable: false,
				status: 409,
			}),
		});
	});

	test("rejects a stale E2EE revision before decrypting or claiming", async () => {
		cryptoService.contentEncryptionEnabled = true;
		cryptoService.decryptRpcPayload.mockReturnValue([
			{ type: "text", text: "must not run" },
		]);
		sessionManager.getSessionRevision.mockReturnValue(3);
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-stale-encrypted-revision",
			params: {
				sessionId: "session-1",
				messageId: "message-stale-encrypted-revision",
				expectedRevision: 2,
				prompt: { t: "encrypted", c: "ciphertext" },
			},
		});

		expect(cryptoService.decryptRpcPayload).not.toHaveBeenCalled();
		expect(sessionManager.claimMessageSend).not.toHaveBeenCalled();
		expect(sessionManager.beginMessageSend).not.toHaveBeenCalled();
		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-stale-encrypted-revision",
			error: expect.objectContaining({
				code: "SESSION_NOT_READY",
				retryable: false,
				status: 409,
			}),
		});
	});

	test("rejects an invalid expected revision at the CLI boundary", async () => {
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-invalid-revision",
			params: {
				sessionId: "session-1",
				messageId: "message-invalid-revision",
				expectedRevision: 1.5,
				prompt: [{ type: "text", text: "must not run" }],
			},
		});

		expect(cryptoService.decryptRpcPayload).not.toHaveBeenCalled();
		expect(sessionManager.claimMessageSend).not.toHaveBeenCalled();
		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-invalid-revision",
			error: expect.objectContaining({
				code: "REQUEST_VALIDATION_FAILED",
				retryable: false,
				status: 400,
			}),
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
		expect(sessionManager.recordTurnEnd).not.toHaveBeenCalled();
		expect(sessionManager.completeMessageSend).toHaveBeenCalledTimes(1);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-concurrent-1",
			result: { stopReason: "end_turn" },
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-concurrent-2",
			result: { stopReason: "end_turn" },
		});
	});

	test("keeps the durable claim when prompt execution has an unknown outcome", async () => {
		let claimActive = false;
		sessionManager.claimMessageSend.mockImplementation(() => {
			if (claimActive) {
				return { status: "in_progress" };
			}
			claimActive = true;
			return { status: "claimed", claimId: "claim-unknown-outcome" };
		});
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

		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
		expect(sessionManager.completeMessageSend).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-failed",
			error: expect.objectContaining({
				code: "MESSAGE_OUTCOME_UNKNOWN",
				retryable: false,
				status: 409,
			}),
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-retry",
			error: expect.objectContaining({
				code: "MESSAGE_OUTCOME_UNKNOWN",
				message: expect.stringContaining("outcome is unknown"),
				retryable: false,
				status: 409,
			}),
		});
	});

	test("redacts prompt failure details from production RPC errors", async () => {
		const previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			promptConnection.prompt.mockImplementationOnce(() =>
				Promise.reject(
					new Error("agent failed at /Users/private/.secrets/api-key"),
				),
			);
			const handler = socketHandlers.get("rpc:message:send");
			if (!handler) {
				throw new Error("rpc:message:send handler not registered");
			}

			await handler({
				requestId: "req-production-prompt-failure",
				params: {
					sessionId: "session-1",
					messageId: "message-production-prompt-failure",
					prompt: [{ type: "text", text: "run once" }],
				},
			});

			expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
				requestId: "req-production-prompt-failure",
				error: {
					code: "MESSAGE_OUTCOME_UNKNOWN",
					message:
						"Message execution outcome is unknown; send it again as a new message",
					retryable: false,
					scope: "request",
					status: 409,
				},
			});
			expect(JSON.stringify(socketMock.emit.mock.calls)).not.toContain(
				"/Users/private/.secrets/api-key",
			);
		} finally {
			if (previousNodeEnv === undefined) {
				delete process.env.NODE_ENV;
			} else {
				process.env.NODE_ENV = previousNodeEnv;
			}
		}
	});

	test("redacts terminal commit failure details from production RPC errors", async () => {
		const previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			sessionManager.completeMessageSend.mockImplementationOnce(() => {
				throw new Error("WAL failed at /var/private/mobvibe/events.db");
			});
			const handler = socketHandlers.get("rpc:message:send");
			if (!handler) {
				throw new Error("rpc:message:send handler not registered");
			}

			await handler({
				requestId: "req-production-commit-failure",
				params: {
					sessionId: "session-1",
					messageId: "message-production-commit-failure",
					prompt: [{ type: "text", text: "run once" }],
				},
			});

			expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
				requestId: "req-production-commit-failure",
				error: {
					code: "MESSAGE_OUTCOME_UNKNOWN",
					message:
						"Message execution outcome is unknown; send it again as a new message",
					retryable: false,
					scope: "request",
					status: 409,
				},
			});
			expect(JSON.stringify(socketMock.emit.mock.calls)).not.toContain(
				"/var/private/mobvibe/events.db",
			);
		} finally {
			if (previousNodeEnv === undefined) {
				delete process.env.NODE_ENV;
			} else {
				process.env.NODE_ENV = previousNodeEnv;
			}
		}
	});

	test("does not prompt again after restart when execution outcome is indeterminate", async () => {
		sessionManager.claimMessageSend.mockReturnValueOnce({
			status: "in_progress",
		});
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-indeterminate",
			params: {
				sessionId: "session-1",
				messageId: "message-indeterminate",
				prompt: [{ type: "text", text: "must not run again" }],
			},
		});

		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-indeterminate",
			error: expect.objectContaining({
				code: "MESSAGE_OUTCOME_UNKNOWN",
				message: expect.stringContaining("outcome is unknown"),
				retryable: false,
				status: 409,
			}),
		});
	});

	test("reports an unknown outcome when the atomic terminal commit fails", async () => {
		sessionManager.completeMessageSend.mockImplementationOnce(() => {
			throw new Error("WAL append failed");
		});
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}
		const params = {
			sessionId: "session-1",
			messageId: "message-post-processing",
			prompt: [{ type: "text", text: "run once" }],
		};

		await handler({ requestId: "req-first", params });

		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
		expect(sessionManager.completeMessageSend).toHaveBeenCalledTimes(1);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-first",
			error: expect.objectContaining({
				code: "MESSAGE_OUTCOME_UNKNOWN",
				retryable: false,
				status: 409,
			}),
		});
	});

	test("does not expose generic exception messages in RPC errors", async () => {
		sessionManager.archiveSession.mockImplementationOnce(() =>
			Promise.reject(new Error("secret database detail")),
		);
		const handler = socketHandlers.get("rpc:session:archive");
		if (!handler) {
			throw new Error("rpc:session:archive handler not registered");
		}

		await handler({
			requestId: "req-generic-error",
			params: { sessionId: "session-1" },
		});

		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-generic-error",
			error: expect.objectContaining({
				code: "INTERNAL_ERROR",
				message: "Internal server error",
				status: 500,
			}),
		});
	});

	test("rejects a different message ID while a session prompt is in flight", async () => {
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

		const first = handler({
			requestId: "req-busy-1",
			params: {
				sessionId: "session-1",
				messageId: "message-busy-1",
				prompt: [{ type: "text", text: "still running" }],
			},
		});
		await Promise.resolve();
		await handler({
			requestId: "req-busy-2",
			params: {
				sessionId: "session-1",
				messageId: "message-busy-2",
				prompt: [{ type: "text", text: "must not queue" }],
			},
		});

		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-busy-2",
			error: expect.objectContaining({
				code: "SESSION_BUSY",
				retryable: true,
			}),
		});
		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
		resolvePrompt?.({ stopReason: "end_turn" });
		await first;
	});

	test("waits for an in-flight prompt before force reloading its session", async () => {
		let resolvePrompt: ((value: { stopReason: string }) => void) | undefined;
		promptConnection.prompt.mockImplementationOnce(
			() =>
				new Promise<{ stopReason: string }>((resolve) => {
					resolvePrompt = resolve;
				}),
		);
		const messageHandler = socketHandlers.get("rpc:message:send");
		const reloadHandler = socketHandlers.get("rpc:session:reload");
		if (!messageHandler || !reloadHandler) {
			throw new Error("session RPC handlers not registered");
		}

		const message = messageHandler({
			requestId: "req-message-before-reload",
			params: {
				sessionId: "session-1",
				messageId: "message-before-reload",
				prompt: [{ type: "text", text: "finish before reload" }],
			},
		});
		const reload = reloadHandler({
			requestId: "req-reload",
			params: {
				sessionId: "session-1",
				cwd: "/tmp/project",
				backendId: "backend-1",
			},
		});
		await Promise.resolve();

		expect(sessionManager.reloadSession).not.toHaveBeenCalled();
		resolvePrompt?.({ stopReason: "end_turn" });
		await Promise.all([message, reload]);

		expect(sessionManager.completeMessageSend).toHaveBeenCalledTimes(1);
		expect(sessionManager.reloadSession).toHaveBeenCalledTimes(1);
	});

	test("checks the revision after a queued reload and before prompt execution", async () => {
		let resolveReload:
			| ((value: { sessionId: string; revision: number }) => void)
			| undefined;
		sessionManager.getSessionRevision.mockReturnValue(2);
		sessionManager.reloadSession.mockImplementationOnce(
			() =>
				new Promise<{ sessionId: string; revision: number }>((resolve) => {
					resolveReload = resolve;
				}),
		);
		const reloadHandler = socketHandlers.get("rpc:session:reload");
		const messageHandler = socketHandlers.get("rpc:message:send");
		if (!reloadHandler || !messageHandler) {
			throw new Error("session RPC handlers not registered");
		}

		const reload = reloadHandler({
			requestId: "req-reload-before-pinned-message",
			params: {
				sessionId: "session-1",
				cwd: "/tmp/project",
				backendId: "backend-1",
			},
		});
		await Promise.resolve();
		const message = messageHandler({
			requestId: "req-pinned-message-after-reload",
			params: {
				sessionId: "session-1",
				messageId: "message-pinned-before-reload",
				expectedRevision: 2,
				prompt: [{ type: "text", text: "must stay on revision 2" }],
			},
		});
		await Promise.resolve();

		expect(cryptoService.decryptRpcPayload).not.toHaveBeenCalled();
		sessionManager.getSessionRevision.mockReturnValue(3);
		resolveReload?.({ sessionId: "session-1", revision: 3 });
		await Promise.all([reload, message]);

		expect(cryptoService.decryptRpcPayload).not.toHaveBeenCalled();
		expect(sessionManager.claimMessageSend).not.toHaveBeenCalled();
		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-pinned-message-after-reload",
			error: expect.objectContaining({
				code: "SESSION_NOT_READY",
				retryable: false,
				status: 409,
			}),
		});
	});

	test("waits for an in-flight prompt before archiving its session", async () => {
		let resolvePrompt: ((value: { stopReason: string }) => void) | undefined;
		promptConnection.prompt.mockImplementationOnce(
			() =>
				new Promise<{ stopReason: string }>((resolve) => {
					resolvePrompt = resolve;
				}),
		);
		const messageHandler = socketHandlers.get("rpc:message:send");
		const archiveHandler = socketHandlers.get("rpc:session:archive");
		if (!messageHandler || !archiveHandler) {
			throw new Error("session RPC handlers not registered");
		}

		const message = messageHandler({
			requestId: "req-message-before-archive",
			params: {
				sessionId: "session-1",
				messageId: "message-before-archive",
				prompt: [{ type: "text", text: "finish before archive" }],
			},
		});
		const archive = archiveHandler({
			requestId: "req-archive",
			params: { sessionId: "session-1" },
		});
		await Promise.resolve();

		expect(sessionManager.archiveSession).not.toHaveBeenCalled();
		resolvePrompt?.({ stopReason: "end_turn" });
		await Promise.all([message, archive]);

		expect(sessionManager.archiveSession).toHaveBeenCalledWith("session-1");
	});

	test("pre-cancels work before closing a session through ACP", async () => {
		const calls: string[] = [];
		sessionManager.cancelSession.mockImplementationOnce(() => {
			calls.push("cancel");
			return Promise.resolve(true);
		});
		sessionManager.closeSession.mockImplementationOnce(() => {
			calls.push("close");
			return Promise.resolve({ sessionId: "session-1", isAttached: false });
		});
		const closeHandler = socketHandlers.get("rpc:session:close");
		if (!closeHandler) {
			throw new Error("session close RPC handler not registered");
		}

		await closeHandler({
			requestId: "req-close",
			params: { sessionId: "session-1" },
		});

		expect(calls).toEqual(["cancel", "close"]);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-close",
			result: { sessionId: "session-1", isAttached: false },
		});
	});

	test("reserves close before awaiting cancellation and rejects a new prompt", async () => {
		let finishCancel: (() => void) | undefined;
		sessionManager.cancelSession.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					finishCancel = () => resolve(true);
				}),
		);
		const closeHandler = socketHandlers.get("rpc:session:close");
		const messageHandler = socketHandlers.get("rpc:message:send");
		if (!closeHandler || !messageHandler) {
			throw new Error("session close or message RPC handler not registered");
		}

		const close = closeHandler({
			requestId: "req-close-reserved",
			params: { sessionId: "session-1" },
		});
		await Promise.resolve();
		await messageHandler({
			requestId: "req-message-during-close",
			params: {
				sessionId: "session-1",
				messageId: "message-during-close",
				prompt: [{ type: "text", text: "do not start" }],
			},
		});

		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(sessionManager.closeSession).not.toHaveBeenCalled();
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-message-during-close",
			error: expect.objectContaining({
				code: "SESSION_BUSY",
				status: 409,
			}),
		});

		finishCancel?.();
		await close;
		expect(sessionManager.closeSession).toHaveBeenCalledWith("session-1");
	});

	test("does not cancel when close capability validation fails", async () => {
		sessionManager.assertSessionCloseSupported.mockImplementationOnce(() => {
			throw new Error("Agent does not support session/close capability");
		});
		const closeHandler = socketHandlers.get("rpc:session:close");
		if (!closeHandler) {
			throw new Error("session close RPC handler not registered");
		}

		await closeHandler({
			requestId: "req-close-unsupported",
			params: { sessionId: "session-1" },
		});

		expect(sessionManager.cancelSession).not.toHaveBeenCalled();
		expect(sessionManager.closeSession).not.toHaveBeenCalled();
	});

	test("pre-cancels work before permanently deleting a session", async () => {
		const calls: string[] = [];
		sessionManager.cancelSession.mockImplementationOnce(() => {
			calls.push("cancel");
			return Promise.resolve(true);
		});
		sessionManager.deleteSession.mockImplementationOnce(() => {
			calls.push("delete");
			return Promise.resolve();
		});
		const deleteHandler = socketHandlers.get("rpc:session:delete");
		if (!deleteHandler) {
			throw new Error("session delete RPC handler not registered");
		}

		await deleteHandler({
			requestId: "req-delete",
			params: { sessionId: "session-1" },
		});

		expect(sessionManager.assertSessionDeleteSupported).toHaveBeenCalledWith(
			"session-1",
		);
		expect(calls).toEqual(["cancel", "delete"]);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-delete",
			result: { ok: true },
		});
	});

	test("shares one in-flight permanent deletion across duplicate RPCs", async () => {
		let finishDelete: (() => void) | undefined;
		sessionManager.deleteSession.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishDelete = resolve;
				}),
		);
		const deleteHandler = socketHandlers.get("rpc:session:delete");
		if (!deleteHandler) {
			throw new Error("session delete RPC handler not registered");
		}

		const first = deleteHandler({
			requestId: "req-delete-first",
			params: { sessionId: "session-1" },
		});
		const second = deleteHandler({
			requestId: "req-delete-second",
			params: { sessionId: "session-1" },
		});
		for (let attempt = 0; attempt < 10 && !finishDelete; attempt++) {
			await Promise.resolve();
		}

		expect(sessionManager.assertSessionDeleteSupported).toHaveBeenCalledTimes(
			1,
		);
		expect(sessionManager.cancelSession).toHaveBeenCalledTimes(1);
		expect(sessionManager.deleteSession).toHaveBeenCalledTimes(1);
		finishDelete?.();
		await Promise.all([first, second]);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-delete-first",
			result: { ok: true },
		});
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-delete-second",
			result: { ok: true },
		});
	});

	test("rejects mutating session operations once permanent deletion is reserved", async () => {
		let finishCancel: (() => void) | undefined;
		sessionManager.cancelSession.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					finishCancel = () => resolve(true);
				}),
		);
		const deleteHandler = socketHandlers.get("rpc:session:delete");
		if (!deleteHandler) {
			throw new Error("session delete RPC handler not registered");
		}
		const deletion = deleteHandler({
			requestId: "req-delete-reserved",
			params: { sessionId: "session-1" },
		});

		const requests: Array<[string, string, Record<string, unknown>]> = [
			[
				"rpc:session:load",
				"req-load-during-delete",
				{
					sessionId: "session-1",
					cwd: "/tmp/project",
					backendId: "backend-1",
				},
			],
			[
				"rpc:session:resume",
				"req-resume-during-delete",
				{
					sessionId: "session-1",
					cwd: "/tmp/project",
					backendId: "backend-1",
				},
			],
			[
				"rpc:session:reload",
				"req-reload-during-delete",
				{
					sessionId: "session-1",
					cwd: "/tmp/project",
					backendId: "backend-1",
				},
			],
			[
				"rpc:session:archive",
				"req-archive-during-delete",
				{ sessionId: "session-1" },
			],
			[
				"rpc:session:close",
				"req-close-during-delete",
				{ sessionId: "session-1" },
			],
			[
				"rpc:session:mode",
				"req-mode-during-delete",
				{ sessionId: "session-1", modeId: "plan" },
			],
			[
				"rpc:session:model",
				"req-model-during-delete",
				{ sessionId: "session-1", modelId: "model-1" },
			],
			[
				"rpc:session:config",
				"req-config-during-delete",
				{ sessionId: "session-1", configId: "mode", value: "fast" },
			],
			[
				"rpc:session:rename",
				"req-rename-during-delete",
				{ sessionId: "session-1", title: "Do not revive" },
			],
		];

		await Promise.all(
			requests.map(async ([event, requestId, params]) => {
				const handler = socketHandlers.get(event);
				if (!handler) throw new Error(`${event} handler not registered`);
				await handler({ requestId, params });
			}),
		);
		const messageHandler = socketHandlers.get("rpc:message:send");
		if (!messageHandler) throw new Error("message handler not registered");
		await messageHandler({
			requestId: "req-message-during-delete",
			params: {
				sessionId: "session-1",
				messageId: "message-during-delete",
				prompt: [{ type: "text", text: "do not run" }],
			},
		});

		for (const [, requestId] of requests) {
			expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
				requestId,
				error: expect.objectContaining({
					code: "SESSION_BUSY",
					status: 409,
				}),
			});
		}
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-message-during-delete",
			error: expect.objectContaining({ code: "SESSION_BUSY", status: 409 }),
		});
		expect(sessionManager.loadSession).not.toHaveBeenCalled();
		expect(sessionManager.resumeSession).not.toHaveBeenCalled();
		expect(sessionManager.reloadSession).not.toHaveBeenCalled();
		expect(sessionManager.archiveSession).not.toHaveBeenCalled();
		expect(sessionManager.closeSession).not.toHaveBeenCalled();
		expect(sessionManager.setSessionMode).not.toHaveBeenCalled();
		expect(sessionManager.setSessionModel).not.toHaveBeenCalled();
		expect(sessionManager.setSessionConfigOption).not.toHaveBeenCalled();
		expect(sessionManager.updateTitle).not.toHaveBeenCalled();
		expect(promptConnection.prompt).not.toHaveBeenCalled();

		finishCancel?.();
		await deletion;
		expect(sessionManager.deleteSession).toHaveBeenCalledWith("session-1");
	});

	test("does not cancel when permanent delete capability validation fails", async () => {
		sessionManager.assertSessionDeleteSupported.mockImplementationOnce(() => {
			throw new Error("Agent does not support session/delete capability");
		});
		const deleteHandler = socketHandlers.get("rpc:session:delete");
		if (!deleteHandler) {
			throw new Error("session delete RPC handler not registered");
		}

		await deleteHandler({
			requestId: "req-delete-unsupported",
			params: { sessionId: "session-1" },
		});

		expect(sessionManager.cancelSession).not.toHaveBeenCalled();
		expect(sessionManager.deleteSession).not.toHaveBeenCalled();
	});

	test("waits for archive completion before loading the same session", async () => {
		let resolveArchive: (() => void) | undefined;
		sessionManager.archiveSession.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveArchive = resolve;
				}),
		);
		const archiveHandler = socketHandlers.get("rpc:session:archive");
		const loadHandler = socketHandlers.get("rpc:session:load");
		if (!archiveHandler || !loadHandler) {
			throw new Error("session RPC handlers not registered");
		}

		const archive = archiveHandler({
			requestId: "req-archive-before-load",
			params: { sessionId: "session-1" },
		});
		const load = loadHandler({
			requestId: "req-load-after-archive",
			params: {
				sessionId: "session-1",
				cwd: "/tmp/project",
				backendId: "backend-1",
			},
		});
		await Promise.resolve();

		expect(sessionManager.loadSession).not.toHaveBeenCalled();
		resolveArchive?.();
		await Promise.all([archive, load]);

		expect(sessionManager.loadSession).toHaveBeenCalledWith(
			"session-1",
			"/tmp/project",
			"backend-1",
			undefined,
		);
	});

	test("forwards resume RPC parameters through the per-session queue", async () => {
		const resumeHandler = socketHandlers.get("rpc:session:resume");
		if (!resumeHandler) {
			throw new Error("rpc:session:resume handler not registered");
		}

		await resumeHandler({
			requestId: "req-resume",
			params: {
				sessionId: "session-1",
				cwd: "/tmp/project",
				additionalDirectories: ["/tmp/shared"],
				backendId: "backend-1",
				machineId: "machine-1",
			},
		});

		expect(sessionManager.resumeSession).toHaveBeenCalledWith(
			"session-1",
			"/tmp/project",
			"backend-1",
			["/tmp/shared"],
		);
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-resume",
			result: { sessionId: "session-1" },
		});
	});

	test("waits for every included session before bulk archiving", async () => {
		let resolvePrompt: ((value: { stopReason: string }) => void) | undefined;
		promptConnection.prompt.mockImplementationOnce(
			() =>
				new Promise<{ stopReason: string }>((resolve) => {
					resolvePrompt = resolve;
				}),
		);
		const messageHandler = socketHandlers.get("rpc:message:send");
		const archiveAllHandler = socketHandlers.get("rpc:session:archive-all");
		if (!messageHandler || !archiveAllHandler) {
			throw new Error("session RPC handlers not registered");
		}

		const message = messageHandler({
			requestId: "req-message-before-bulk-archive",
			params: {
				sessionId: "session-1",
				messageId: "message-before-bulk-archive",
				prompt: [{ type: "text", text: "finish before bulk archive" }],
			},
		});
		const archive = archiveAllHandler({
			requestId: "req-bulk-archive",
			params: { sessionIds: ["session-2", "session-1"] },
		});
		await Promise.resolve();

		expect(sessionManager.bulkArchiveSessions).not.toHaveBeenCalled();
		resolvePrompt?.({ stopReason: "end_turn" });
		await Promise.all([message, archive]);

		expect(sessionManager.bulkArchiveSessions).toHaveBeenCalledWith([
			"session-2",
			"session-1",
		]);
	});

	test("does not retain a queue of distinct messages for the same session", async () => {
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
		await second;
		expect(socketMock.emit).toHaveBeenCalledWith("rpc:response", {
			requestId: "req-serial-2",
			error: expect.objectContaining({ code: "SESSION_BUSY", status: 409 }),
		});
		expect(promptConnection.prompt.mock.calls[0]?.[1]).toEqual([
			{ type: "text", text: "first" },
		]);
		resolveFirstPrompt?.({ stopReason: "end_turn" });
		await first;
		expect(promptConnection.prompt).toHaveBeenCalledTimes(1);
	});

	test("replays a durable completed result without prompting again", async () => {
		sessionManager.getMessageSendResult.mockReturnValueOnce({
			stopReason: "end_turn",
		});
		sessionManager.getSessionRevision.mockReturnValue(2);
		sessionManager.getSessionRevision.mockClear();
		const handler = socketHandlers.get("rpc:message:send");
		if (!handler) {
			throw new Error("rpc:message:send handler not registered");
		}

		await handler({
			requestId: "req-durable-retry",
			params: {
				sessionId: "session-1",
				messageId: "message-completed",
				expectedRevision: 1,
				prompt: [{ type: "text", text: "must not run again" }],
			},
		});

		expect(promptConnection.prompt).not.toHaveBeenCalled();
		expect(sessionManager.getSessionRevision).not.toHaveBeenCalled();
		expect(cryptoService.decryptRpcPayload).not.toHaveBeenCalled();
		expect(sessionManager.claimMessageSend).not.toHaveBeenCalled();
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
				code: "REQUEST_VALIDATION_FAILED",
				message: "Selected backend does not support image prompts",
				status: 400,
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
				code: "REQUEST_VALIDATION_FAILED",
				message: "Each image must be 512 KiB or smaller",
				status: 400,
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
