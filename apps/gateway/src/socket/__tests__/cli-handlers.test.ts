import type {
	AgentTeamSummary,
	AgentTeamsChangedPayload,
	CliRegistrationInfo,
	SessionSummary,
} from "@mobvibe/shared";
import { verifySignedToken } from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliRegistry } from "../../services/cli-registry.js";
import {
	findDeviceByPublicKey,
	upsertMachine,
} from "../../services/db-service.js";
import type { NotificationService } from "../../services/notification-service.js";
import type { SessionRouter } from "../../services/session-router.js";
import type { TeamRouter } from "../../services/team-router.js";
import { setupCliHandlers } from "../cli-handlers.js";

vi.mock("@mobvibe/shared", () => ({
	initCrypto: vi.fn().mockResolvedValue(undefined),
	verifySignedToken: vi.fn(),
}));

vi.mock("../../services/db-service.js", () => ({
	upsertMachine: vi.fn(),
	findDeviceByPublicKey: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

const createMockSessionSummary = (
	overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
	sessionId: `session-${Math.random().toString(36).slice(2, 8)}`,
	title: "Test Session",
	backendId: "backend-1",
	backendLabel: "Claude Code",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const createMockRegistrationInfo = (
	overrides: Partial<CliRegistrationInfo> = {},
): CliRegistrationInfo => ({
	machineId: `machine-${Math.random().toString(36).slice(2, 8)}`,
	hostname: "test-host",
	version: "1.0.0",
	backends: [{ backendId: "backend-1", backendLabel: "Claude Code" }],
	...overrides,
});

const createMockAgentTeam = (
	overrides: Partial<AgentTeamSummary> = {},
): AgentTeamSummary => ({
	agentTeamId: "team-1",
	machineId: "machine-1",
	title: "Team One",
	workspaceRootCwd: "/repo",
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
	...overrides,
});

describe("setupCliHandlers", () => {
	let registry: CliRegistry;
	let emitToWebui: ReturnType<typeof vi.fn>;
	let notificationService: {
		notifyPermissionRequest: ReturnType<typeof vi.fn>;
		notifySessionEvent: ReturnType<typeof vi.fn>;
	};
	let sessionRouter: {
		handleRpcResponse: ReturnType<typeof vi.fn>;
		handleCliDisconnect: ReturnType<typeof vi.fn>;
	};
	let teamRouter: {
		handleRpcResponse: ReturnType<typeof vi.fn>;
		handleCliDisconnect: ReturnType<typeof vi.fn>;
	};
	let connectionHandler: ((socket: Socket) => void) | undefined;
	let socketHandlers: Record<string, (payload?: unknown) => void>;
	let socket: Socket;

	beforeEach(() => {
		vi.mocked(upsertMachine).mockResolvedValue({
			machineId: "machine-1",
			userId: "user-1",
		});
		registry = new CliRegistry();
		emitToWebui = vi.fn();
		notificationService = {
			notifyPermissionRequest: vi.fn(),
			notifySessionEvent: vi.fn(),
		};
		sessionRouter = {
			handleRpcResponse: vi.fn(),
			handleCliDisconnect: vi.fn(),
		};
		teamRouter = {
			handleRpcResponse: vi.fn(),
			handleCliDisconnect: vi.fn(),
		};
		socketHandlers = {};
		socket = {
			id: "socket-1",
			handshake: { headers: {} },
			data: { userId: "user-1", deviceId: "device-123" },
			on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
				socketHandlers[event] = handler;
			}),
			emit: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as Socket;

		const namespace = {
			use: vi.fn(),
			on: vi.fn((event: string, handler: (socket: Socket) => void) => {
				if (event === "connection") {
					connectionHandler = handler;
				}
			}),
		};

		const io = {
			of: vi.fn(() => namespace),
		} as unknown as Server;

		setupCliHandlers(
			io,
			registry,
			sessionRouter as unknown as SessionRouter,
			teamRouter as unknown as TeamRouter,
			emitToWebui,
			() => null,
			undefined,
			notificationService as unknown as NotificationService,
		);

		connectionHandler?.(socket);
	});

	it("relays agent team changed events only to the owning user", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});
		const payload: AgentTeamsChangedPayload = {
			added: [createMockAgentTeam({ machineId: "machine-1" })],
			updated: [],
			removed: [],
		};

		socketHandlers["agent-teams:changed"]?.(payload);

		expect(emitToWebui).toHaveBeenCalledWith(
			"agent-teams:changed",
			{
				...payload,
				machineId: "machine-1",
			},
			"user-1",
		);
	});

	it("contains direct registered-event handler failures and disconnects for replay", () => {
		registry.register(socket, createMockRegistrationInfo(), {
			userId: "user-1",
			deviceId: "device-123",
		});
		emitToWebui.mockImplementation(() => {
			throw new Error("relay failed");
		});
		const event = {
			sessionId: "session-1",
			machineId: "machine-spoofed",
			revision: 1,
			seq: 1,
			kind: "user_message",
			createdAt: "2026-07-16T00:00:00.000Z",
			payload: {},
		};

		expect(() => socketHandlers["session:event"]?.(event)).not.toThrow();

		expect(socket.disconnect).toHaveBeenCalledWith(true);
		expect(socket.emit).not.toHaveBeenCalledWith(
			"events:ack",
			expect.anything(),
		);
	});

	it("replaces spoofed agent-team machine IDs with the authenticated machine", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});
		const payload: AgentTeamsChangedPayload = {
			machineId: "victim-machine",
			added: [createMockAgentTeam({ machineId: "victim-machine" })],
			updated: [],
			removed: [],
		};

		socketHandlers["agent-teams:changed"]?.(payload);

		expect(emitToWebui).toHaveBeenCalledWith(
			"agent-teams:changed",
			expect.objectContaining({
				machineId: "machine-1",
				added: [expect.objectContaining({ machineId: "machine-1" })],
			}),
			"user-1",
		);
	});

	it("does not broadcast agent team changes from unknown CLI sockets", () => {
		const payload: AgentTeamsChangedPayload = {
			added: [createMockAgentTeam()],
			updated: [],
			removed: [],
		};

		socketHandlers["agent-teams:changed"]?.(payload);

		expect(emitToWebui).not.toHaveBeenCalledWith(
			"agent-teams:changed",
			expect.anything(),
			expect.anything(),
		);
	});

	it("routes rpc responses to session and team routers", () => {
		const response = { requestId: "rpc-1", result: { ok: true } };

		socketHandlers["rpc:response"]?.(response);

		expect(sessionRouter.handleRpcResponse).toHaveBeenCalledWith(
			response,
			socket.id,
		);
		expect(teamRouter.handleRpcResponse).toHaveBeenCalledWith(
			response,
			socket.id,
		);
	});

	it("preserves the initial session list while CLI registration is pending", async () => {
		let finishUpsert:
			| ((value: { machineId: string; userId: string }) => void)
			| undefined;
		vi.mocked(upsertMachine).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishUpsert = resolve;
				}),
		);
		const session = createMockSessionSummary({
			sessionId: "session-during-init",
		});

		socketHandlers["cli:register"]?.(
			createMockRegistrationInfo({ machineId: "raw-machine-1" }),
		);
		socketHandlers["sessions:list"]?.([session]);
		finishUpsert?.({ machineId: "machine-1", userId: "user-1" });

		await vi.waitFor(() => {
			expect(registry.getCliBySocketId(socket.id)?.sessions).toEqual([session]);
		});
	});

	it("relays and acknowledges WAL events received while registration is pending", async () => {
		let finishUpsert:
			| ((value: { machineId: string; userId: string }) => void)
			| undefined;
		vi.mocked(upsertMachine).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishUpsert = resolve;
				}),
		);
		const event = {
			sessionId: "session-during-init",
			machineId: "machine-1",
			revision: 2,
			seq: 7,
			kind: "agent_message_chunk" as const,
			createdAt: "2026-07-16T00:00:00.000Z",
			payload: { text: "not lost" },
		};

		socketHandlers["cli:register"]?.(
			createMockRegistrationInfo({ machineId: "raw-machine-1" }),
		);
		socketHandlers["session:event"]?.(event);
		finishUpsert?.({ machineId: "machine-1", userId: "user-1" });

		await vi.waitFor(() => {
			expect(emitToWebui).toHaveBeenCalledWith(
				"session:event",
				event,
				"user-1",
			);
			expect(socket.emit).toHaveBeenCalledWith("events:ack", {
				sessionId: event.sessionId,
				revision: event.revision,
				upToSeq: event.seq,
			});
		});
	});

	it("does not create a ghost CLI when the socket disconnects during registration", async () => {
		let finishUpsert:
			| ((value: { machineId: string; userId: string }) => void)
			| undefined;
		vi.mocked(upsertMachine).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishUpsert = resolve;
				}),
		);

		socketHandlers["cli:register"]?.(
			createMockRegistrationInfo({ machineId: "raw-machine-1" }),
		);
		await socketHandlers.disconnect?.("transport close");
		finishUpsert?.({ machineId: "machine-1", userId: "user-1" });
		await Promise.resolve();
		await Promise.resolve();

		expect(registry.getCliBySocketId(socket.id)).toBeUndefined();
		expect(socket.emit).not.toHaveBeenCalledWith(
			"cli:registered",
			expect.anything(),
		);
	});

	it("disconnects instead of buffering an unbounded pre-registration flood", async () => {
		let finishUpsert:
			| ((value: { machineId: string; userId: string }) => void)
			| undefined;
		vi.mocked(upsertMachine).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishUpsert = resolve;
				}),
		);

		socketHandlers["cli:register"]?.(
			createMockRegistrationInfo({ machineId: "raw-machine-1" }),
		);
		for (let seq = 1; seq <= 1_001; seq += 1) {
			socketHandlers["session:event"]?.({
				sessionId: "session-flood",
				machineId: "machine-1",
				revision: 1,
				seq,
				kind: "agent_message_chunk",
				createdAt: "2026-07-16T00:00:00.000Z",
				payload: {},
			});
		}
		finishUpsert?.({ machineId: "machine-1", userId: "user-1" });
		await Promise.resolve();
		await Promise.resolve();

		expect(socket.disconnect).toHaveBeenCalledWith(true);
		expect(registry.getCliBySocketId(socket.id)).toBeUndefined();
		expect(socket.emit).not.toHaveBeenCalledWith(
			"events:ack",
			expect.anything(),
		);
	});

	it("forwards session:attached events to webui", () => {
		// Register the socket first so the guard passes
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:attached"]?.({
			sessionId: "session-1",
			machineId: "machine-1",
			attachedAt: "2024-01-01T00:00:00Z",
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:attached",
			{
				sessionId: "session-1",
				machineId: "machine-1",
				attachedAt: "2024-01-01T00:00:00Z",
			},
			"user-1",
		);
	});

	it("forwards session:detached events to webui", () => {
		// Register the socket first so the guard passes
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:detached"]?.({
			sessionId: "session-1",
			machineId: "machine-1",
			detachedAt: "2024-01-01T00:00:00Z",
			reason: "agent_exit",
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:detached",
			{
				sessionId: "session-1",
				machineId: "machine-1",
				detachedAt: "2024-01-01T00:00:00Z",
				reason: "agent_exit",
			},
			"user-1",
		);
	});

	it("dispatches permission request notifications", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["permission:request"]?.({
			sessionId: "session-1",
			requestId: "request-1",
			options: [],
		});

		expect(notificationService.notifyPermissionRequest).toHaveBeenCalledWith(
			"user-1",
			expect.objectContaining({
				sessionId: "session-1",
				requestId: "request-1",
			}),
		);
	});

	it("does not dispatch permission notifications for inactive sessions", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});
		registry.updateSessions("socket-1", [
			createMockSessionSummary({
				sessionId: "session-1",
				isAttached: false,
			}),
		]);

		socketHandlers["permission:request"]?.({
			sessionId: "session-1",
			requestId: "request-1",
			options: [],
		});

		expect(notificationService.notifyPermissionRequest).not.toHaveBeenCalled();
	});

	it("dispatches session event notifications", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:event"]?.({
			sessionId: "session-1",
			revision: 1,
			seq: 9,
			kind: "turn_end",
			createdAt: new Date().toISOString(),
			payload: {},
		});

		expect(notificationService.notifySessionEvent).toHaveBeenCalledWith(
			"user-1",
			expect.objectContaining({
				sessionId: "session-1",
				kind: "turn_end",
			}),
		);
	});

	it("replaces spoofed session-event machine IDs with the authenticated machine", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:event"]?.({
			sessionId: "session-1",
			machineId: "victim-machine",
			revision: 1,
			seq: 9,
			kind: "turn_end",
			createdAt: new Date().toISOString(),
			payload: {},
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:event",
			expect.objectContaining({ machineId: "machine-1" }),
			"user-1",
		);
	});

	it("does not dispatch session notifications for inactive sessions", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});
		registry.updateSessions("socket-1", [
			createMockSessionSummary({
				sessionId: "session-1",
				isAttached: false,
			}),
		]);

		socketHandlers["session:event"]?.({
			sessionId: "session-1",
			revision: 1,
			seq: 9,
			kind: "turn_end",
			createdAt: new Date().toISOString(),
			payload: {},
		});

		expect(notificationService.notifySessionEvent).not.toHaveBeenCalled();
	});

	it("does NOT emit detached for discovered (non-attached) sessions on disconnect", async () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});
		registry.updateSessions("socket-1", [
			createMockSessionSummary({
				sessionId: "attached-session",
				isAttached: true,
			}),
			createMockSessionSummary({
				sessionId: "discovered-session",
				// isAttached not set → should be skipped
			}),
		]);

		await socketHandlers.disconnect?.("transport close");

		// Should only emit for the attached session
		expect(emitToWebui).toHaveBeenCalledTimes(1);
		expect(emitToWebui).toHaveBeenCalledWith(
			"session:detached",
			expect.objectContaining({
				sessionId: "attached-session",
				machineId: "machine-1",
				reason: "cli_disconnect",
			}),
			"user-1",
		);
		// Should NOT have been called for discovered-session
		expect(emitToWebui).not.toHaveBeenCalledWith(
			"session:detached",
			expect.objectContaining({
				sessionId: "discovered-session",
			}),
			expect.anything(),
		);
	});

	it("emits detached events for active sessions on disconnect", async () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});
		registry.updateSessions("socket-1", [
			createMockSessionSummary({ sessionId: "session-1", isAttached: true }),
			createMockSessionSummary({ sessionId: "session-2", isAttached: true }),
		]);

		await socketHandlers.disconnect?.("transport close");

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:detached",
			expect.objectContaining({
				sessionId: "session-1",
				machineId: "machine-1",
				reason: "cli_disconnect",
				detachedAt: expect.any(String),
			}),
			"user-1",
		);
		expect(emitToWebui).toHaveBeenCalledWith(
			"session:detached",
			expect.objectContaining({
				sessionId: "session-2",
				machineId: "machine-1",
				reason: "cli_disconnect",
				detachedAt: expect.any(String),
			}),
			"user-1",
		);
	});

	it("uses user affinity initialized after handlers are installed", async () => {
		const localRegistry = new CliRegistry();
		const localHandlers: Record<string, (payload?: unknown) => void> = {};
		let localConnectionHandler: ((socket: Socket) => void) | undefined;
		const namespace = {
			use: vi.fn(),
			on: vi.fn((event: string, handler: (connectedSocket: Socket) => void) => {
				if (event === "connection") localConnectionHandler = handler;
			}),
			sockets: new Map(),
		};
		const localIo = { of: vi.fn(() => namespace) } as unknown as Server;
		let affinity: {
			claimUser: ReturnType<typeof vi.fn>;
			releaseUser: ReturnType<typeof vi.fn>;
		} | null = null;
		setupCliHandlers(
			localIo,
			localRegistry,
			sessionRouter as unknown as SessionRouter,
			teamRouter as unknown as TeamRouter,
			vi.fn(),
			(() => affinity) as never,
			undefined,
		);
		const localSocket = {
			id: "socket-late-affinity",
			handshake: { headers: {} },
			data: { userId: "user-1", deviceId: "device-1" },
			on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
				localHandlers[event] = handler;
			}),
			emit: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as Socket;
		localConnectionHandler?.(localSocket);
		affinity = {
			claimUser: vi.fn(async () => true),
			releaseUser: vi.fn(async () => undefined),
		};

		localHandlers["cli:register"]?.(
			createMockRegistrationInfo({ machineId: "raw-machine-1" }),
		);

		await vi.waitFor(() => {
			expect(affinity?.claimUser).toHaveBeenCalledWith("user-1");
		});
		await localHandlers.disconnect?.("transport close");

		expect(affinity.releaseUser).not.toHaveBeenCalled();
	});

	it("atomically claims affinity before accepting a CLI connection", async () => {
		let authMiddleware:
			| ((socket: Socket, next: (error?: Error) => void) => Promise<void>)
			| undefined;
		const namespace = {
			use: vi.fn(
				(
					middleware: (
						socket: Socket,
						next: (error?: Error) => void,
					) => Promise<void>,
				) => {
					authMiddleware = middleware;
				},
			),
			on: vi.fn(),
		};
		const localIo = { of: vi.fn(() => namespace) } as unknown as Server;
		let claimAttempted = false;
		const affinity = {
			claimUser: vi.fn(async () => {
				claimAttempted = true;
				return false;
			}),
			getUserInstance: vi.fn(async () =>
				claimAttempted ? { instanceId: "instance-owner", region: "ord" } : null,
			),
			releaseUser: vi.fn(),
		};
		setupCliHandlers(
			localIo,
			new CliRegistry(),
			sessionRouter as unknown as SessionRouter,
			teamRouter as unknown as TeamRouter,
			vi.fn(),
			() => affinity as never,
			{ instanceId: "instance-local" } as never,
		);
		vi.mocked(verifySignedToken).mockReturnValue({ publicKey: "public-key" });
		vi.mocked(findDeviceByPublicKey).mockResolvedValue({
			id: "device-1",
			userId: "user-1",
		});
		const socket = {
			id: "socket-affinity-race",
			handshake: {
				auth: {
					payload: {
						publicKey: "public-key",
						timestamp: "2026-07-16T00:00:00.000Z",
					},
					signature: "signature",
				},
			},
			data: {},
		} as unknown as Socket;
		const next = vi.fn();

		await authMiddleware?.(socket, next);

		expect(affinity.claimUser).toHaveBeenCalledWith("user-1");
		expect(next).toHaveBeenCalledWith(
			expect.objectContaining({ message: "WRONG_INSTANCE:instance-owner" }),
		);
	});
});
