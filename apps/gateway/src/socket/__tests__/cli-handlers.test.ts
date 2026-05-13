import type {
	AgentTeamSummary,
	AgentTeamsChangedPayload,
	CliRegistrationInfo,
	SessionSummary,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliRegistry } from "../../services/cli-registry.js";
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
	let sessionRouter: { handleRpcResponse: ReturnType<typeof vi.fn> };
	let teamRouter: { handleRpcResponse: ReturnType<typeof vi.fn> };
	let connectionHandler: ((socket: Socket) => void) | undefined;
	let socketHandlers: Record<string, (payload?: unknown) => void>;
	let socket: Socket;

	beforeEach(() => {
		registry = new CliRegistry();
		emitToWebui = vi.fn();
		notificationService = {
			notifyPermissionRequest: vi.fn(),
			notifySessionEvent: vi.fn(),
		};
		sessionRouter = { handleRpcResponse: vi.fn() };
		teamRouter = { handleRpcResponse: vi.fn() };
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
			null,
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

		expect(sessionRouter.handleRpcResponse).toHaveBeenCalledWith(response);
		expect(teamRouter.handleRpcResponse).toHaveBeenCalledWith(response);
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
});
