import type {
	AgentTeamSummary,
	AgentTeamsChangedPayload,
	CliRegistrationInfo,
	SessionSummary,
	TeamRelayCiphertext,
	TeamRelayPublicKey,
	TeamRelayReadyAck,
} from "@mobvibe/shared";
import {
	AppError,
	createErrorDetail,
	verifySignedToken,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../lib/logger.js";
import { CliRegistry } from "../../services/cli-registry.js";
import {
	findDeviceByPublicKey,
	upsertMachine,
} from "../../services/db-service.js";
import type { NotificationService } from "../../services/notification-service.js";
import type { SessionRouter } from "../../services/session-router.js";
import type { TeamRouter } from "../../services/team-router.js";
import { setupCliHandlers } from "../cli-handlers.js";

vi.mock("@mobvibe/shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("@mobvibe/shared")>()),
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

const createMockRelayKey = (seed: number): TeamRelayPublicKey => {
	const publicKey = Buffer.alloc(32, seed).toString("base64");
	return {
		version: 1,
		keyId: `x25519:${publicKey}`,
		publicKey,
	};
};

const createMockRelayCiphertext = (
	recipientKeyId: string,
	seed: number,
): TeamRelayCiphertext => ({
	version: 1,
	recipientKeyId,
	wrappedDek: Buffer.alloc(80, seed).toString("base64"),
	payload: {
		t: "encrypted",
		c: Buffer.alloc(64, seed).toString("base64"),
	},
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
		placeRelayPeer: ReturnType<typeof vi.fn>;
		resolveRelayPeer: ReturnType<typeof vi.fn>;
		relay: ReturnType<typeof vi.fn>;
	};
	let connectionHandler: ((socket: Socket) => void) | undefined;
	let socketHandlers: Record<
		string,
		(payload?: unknown, ack?: (response: unknown) => void) => void
	>;
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
			placeRelayPeer: vi.fn(),
			resolveRelayPeer: vi.fn(),
			relay: vi.fn(),
		};
		socketHandlers = {};
		socket = {
			id: "socket-1",
			handshake: { headers: {} },
			data: { userId: "user-1", deviceId: "device-123" },
			on: vi.fn(
				(
					event: string,
					handler: (
						payload?: unknown,
						ack?: (response: unknown) => void,
					) => void,
				) => {
					socketHandlers[event] = handler;
				},
			),
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

	it("routes Team relay placement, resolve, and send through the authenticated CLI record", async () => {
		const sourceRelayKey = createMockRelayKey(1);
		const targetRelayKey = createMockRelayKey(2);
		const responseCiphertext = createMockRelayCiphertext(
			sourceRelayKey.keyId,
			4,
		);
		const record = registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-source",
				teamRelayKey: sourceRelayKey,
			}),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);
		teamRouter.resolveRelayPeer.mockResolvedValue({
			targetMachineId: "machine-target",
			relayKey: targetRelayKey,
		});
		teamRouter.placeRelayPeer.mockResolvedValue({
			targetMachineId: "machine-target",
			relayKey: targetRelayKey,
		});
		teamRouter.relay.mockResolvedValue({
			operationId: "operation-1",
			targetMachineId: "machine-target",
			ciphertext: responseCiphertext,
		});
		const placeAck = vi.fn();
		const resolveAck = vi.fn();
		const sendAck = vi.fn();

		socketHandlers["team-relay:place"]?.(
			{
				requestId: "place-request-1",
				params: { backendId: "backend-1" },
			},
			placeAck,
		);
		socketHandlers["team-relay:resolve"]?.(
			{
				requestId: "resolve-request-1",
				params: { targetMachineId: "machine-target" },
			},
			resolveAck,
		);
		const requestCiphertext = createMockRelayCiphertext(
			targetRelayKey.keyId,
			3,
		);
		socketHandlers["team-relay:send"]?.(
			{
				requestId: "send-request-1",
				params: {
					operationId: "operation-1",
					targetMachineId: "machine-target",
					ciphertext: requestCiphertext,
				},
			},
			sendAck,
		);

		await vi.waitFor(() => {
			expect(teamRouter.placeRelayPeer).toHaveBeenCalledWith(
				{ backendId: "backend-1" },
				record,
			);
			expect(teamRouter.resolveRelayPeer).toHaveBeenCalledWith(
				{ targetMachineId: "machine-target" },
				record,
			);
			expect(teamRouter.relay).toHaveBeenCalledWith(
				{
					operationId: "operation-1",
					targetMachineId: "machine-target",
					ciphertext: requestCiphertext,
				},
				record,
			);
			expect(placeAck).toHaveBeenCalledWith({
				requestId: "place-request-1",
				result: {
					targetMachineId: "machine-target",
					relayKey: targetRelayKey,
				},
			});
			expect(resolveAck).toHaveBeenCalledWith({
				requestId: "resolve-request-1",
				result: {
					targetMachineId: "machine-target",
					relayKey: targetRelayKey,
				},
			});
			expect(sendAck).toHaveBeenCalledWith({
				requestId: "send-request-1",
				result: {
					operationId: "operation-1",
					targetMachineId: "machine-target",
					ciphertext: responseCiphertext,
				},
			});
		});
	});

	it("sanitizes Team relay handler failures before acknowledging the source", async () => {
		registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-source",
				teamRelayKey: createMockRelayKey(1),
			}),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);
		teamRouter.relay.mockRejectedValue(
			new Error("ENOENT /Users/alice/private/team-relay.json"),
		);
		const ack = vi.fn();

		socketHandlers["team-relay:send"]?.(
			{
				requestId: "send-request-private-error",
				params: {
					operationId: "operation-private-error",
					targetMachineId: "machine-target",
					ciphertext: createMockRelayCiphertext(createMockRelayKey(2).keyId, 3),
				},
			},
			ack,
		);

		await vi.waitFor(() => {
			expect(ack).toHaveBeenCalledWith({
				requestId: "send-request-private-error",
				error: {
					code: "INTERNAL_ERROR",
					message: "Internal server error",
					retryable: true,
					scope: "request",
					status: 500,
				},
			});
		});
	});

	it("does not leak structured Team relay business error messages or detail", async () => {
		registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-source",
				teamRelayKey: createMockRelayKey(1),
			}),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);
		teamRouter.relay.mockRejectedValue(
			new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "ENOENT /Users/alice/private/team-relay.json",
					retryable: false,
					scope: "request",
					detail: "private target stack",
				}),
				422,
			),
		);
		const ack = vi.fn();

		socketHandlers["team-relay:send"]?.(
			{
				requestId: "send-request-structured-private-error",
				params: {
					operationId: "operation-structured-private-error",
					targetMachineId: "machine-target",
					ciphertext: createMockRelayCiphertext(createMockRelayKey(2).keyId, 3),
				},
			},
			ack,
		);

		await vi.waitFor(() => {
			expect(ack).toHaveBeenCalledWith({
				requestId: "send-request-structured-private-error",
				error: {
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid Team relay request",
					retryable: false,
					scope: "request",
					status: 400,
				},
			});
		});
	});

	it("rejects plaintext fields outside Team relay params without dispatching", async () => {
		registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-source",
				teamRelayKey: createMockRelayKey(1),
			}),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);
		const ack = vi.fn();

		socketHandlers["team-relay:send"]?.(
			{
				requestId: "send-request-extra-field",
				params: {
					operationId: "operation-extra-field",
					targetMachineId: "machine-target",
					ciphertext: createMockRelayCiphertext(createMockRelayKey(2).keyId, 3),
				},
				body: { prompt: "must stay encrypted" },
			},
			ack,
		);

		await vi.waitFor(() => {
			expect(teamRouter.relay).not.toHaveBeenCalled();
			expect(ack).toHaveBeenCalledWith({
				requestId: "send-request-extra-field",
				error: {
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid Team relay request",
					retryable: false,
					scope: "request",
					status: 400,
				},
			});
		});
	});

	it("bounds Team relay request IDs before logging or acknowledging them", async () => {
		registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-source",
				teamRelayKey: createMockRelayKey(1),
			}),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);
		const ack = vi.fn();

		socketHandlers["team-relay:resolve"]?.(
			{
				requestId: "x".repeat(129),
				params: { targetMachineId: "machine-target" },
			},
			ack,
		);

		await vi.waitFor(() => {
			expect(teamRouter.resolveRelayPeer).not.toHaveBeenCalled();
			expect(ack).toHaveBeenCalledWith({
				requestId: "invalid-team-relay-request",
				error: {
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid Team relay request",
					retryable: false,
					scope: "request",
					status: 400,
				},
			});
		});
	});

	it("drops invalid list metadata without dropping core sessions", () => {
		registry.register(socket, createMockRegistrationInfo(), {
			userId: "user-1",
			deviceId: "device-123",
		});
		const opaque = `must-not-leak-${"x".repeat(66 * 1024)}`;
		const validMeta = { nested: { retained: true } };
		vi.mocked(logger.warn).mockClear();

		socketHandlers["sessions:list"]?.([
			createMockSessionSummary({
				sessionId: "oversized-meta",
				title: "Core session survives",
				_meta: { opaque },
			}),
			createMockSessionSummary({
				sessionId: "valid-meta",
				_meta: validMeta,
			}),
		]);
		validMeta.nested.retained = false;

		const sessions = registry.getCliBySocketId(socket.id)?.sessions;
		expect(sessions).toHaveLength(2);
		const oversized = sessions?.find(
			(session) => session.sessionId === "oversized-meta",
		);
		expect(oversized?.title).toBe("Core session survives");
		expect(Object.hasOwn(oversized ?? {}, "_meta")).toBe(false);
		expect(
			sessions?.find((session) => session.sessionId === "valid-meta")?._meta,
		).toEqual({ nested: { retained: true } });
		expect(logger.warn).toHaveBeenCalledWith(
			{
				event: "sessions:list",
				socketId: socket.id,
				reason: "session_meta_rejected",
				rejectedCount: 1,
			},
			"session_meta_sanitization_warning",
		);
		expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
			"must-not-leak",
		);
	});

	it("shares the metadata envelope budget across added and updated sessions", () => {
		registry.register(socket, createMockRegistrationInfo(), {
			userId: "user-1",
			deviceId: "device-123",
		});
		registry.updateSessions(socket.id, [
			createMockSessionSummary({
				sessionId: "updated-after-budget",
				title: "Before",
			}),
		]);
		vi.mocked(logger.warn).mockClear();

		socketHandlers["sessions:changed"]?.({
			added: Array.from({ length: 64 }, (_, index) =>
				createMockSessionSummary({
					sessionId: `added-${index}`,
					_meta: { index },
				}),
			),
			updated: [
				createMockSessionSummary({
					sessionId: "updated-after-budget",
					title: "After",
					_meta: { envelope: 65 },
				}),
			],
			removed: [],
		});

		const updated = registry
			.getCliBySocketId(socket.id)
			?.sessions.find(
				(session) => session.sessionId === "updated-after-budget",
			);
		expect(updated?.title).toBe("After");
		expect(Object.hasOwn(updated ?? {}, "_meta")).toBe(false);
		expect(registry.getCliBySocketId(socket.id)?.sessions).toHaveLength(65);
		expect(logger.warn).toHaveBeenCalledWith(
			{
				event: "sessions:changed",
				socketId: socket.id,
				reason: "session_meta_rejected",
				rejectedCount: 1,
			},
			"session_meta_sanitization_warning",
		);
	});

	it("keeps discovered session state when its metadata is rejected", () => {
		registry.register(socket, createMockRegistrationInfo(), {
			userId: "user-1",
			deviceId: "device-123",
		});
		vi.mocked(logger.warn).mockClear();

		socketHandlers["sessions:discovered"]?.({
			sessions: [
				{
					sessionId: "discovered-invalid-meta",
					cwd: "/repo",
					title: "Discovered core state",
					_meta: { oversized: "x".repeat(66 * 1024) },
				},
			],
			backendId: "backend-1",
			backendLabel: "Claude Code",
		});

		const discovered = registry
			.getCliBySocketId(socket.id)
			?.sessions.find(
				(session) => session.sessionId === "discovered-invalid-meta",
			);
		expect(discovered?.title).toBe("Discovered core state");
		expect(Object.hasOwn(discovered ?? {}, "_meta")).toBe(false);
		expect(emitToWebui).toHaveBeenCalledWith(
			"sessions:changed",
			expect.objectContaining({
				added: [
					expect.objectContaining({
						sessionId: "discovered-invalid-meta",
					}),
				],
			}),
			"user-1",
		);
	});

	it("rejects discovery for a backend registered only on another machine", () => {
		registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-1",
				backends: [{ backendId: "backend-1", backendLabel: "Machine One" }],
			}),
			{ userId: "user-1", deviceId: "device-1" },
		);
		const otherSocket = {
			id: "socket-2",
			disconnect: vi.fn(),
		} as unknown as Socket;
		registry.register(
			otherSocket,
			createMockRegistrationInfo({
				machineId: "machine-2",
				backends: [
					{ backendId: "other-machine-only", backendLabel: "Machine Two" },
				],
			}),
			{ userId: "user-1", deviceId: "device-2" },
		);
		emitToWebui.mockClear();
		vi.mocked(logger.warn).mockClear();

		socketHandlers["sessions:discovered"]?.({
			sessions: [
				{
					sessionId: "cross-machine-session",
					cwd: "/private/repo",
					title: "Must not be accepted",
				},
			],
			capabilities: {
				list: true,
				load: true,
			},
			backendId: "other-machine-only",
			backendLabel: "Spoofed label",
		});

		expect(
			registry
				.getCliBySocketId(socket.id)
				?.sessions.some(
					(session) => session.sessionId === "cross-machine-session",
				),
		).toBe(false);
		expect(
			registry.getCliBySocketId(socket.id)?.backendCapabilities,
		).toBeUndefined();
		expect(emitToWebui).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(
			{
				socketId: socket.id,
				machineId: "machine-1",
				backendId: "other-machine-only",
			},
			"sessions_discovered_unknown_backend",
		);
	});

	it("uses the registered backend label for discovered sessions", () => {
		registry.register(
			socket,
			createMockRegistrationInfo({
				backends: [{ backendId: "backend-1", backendLabel: "Trusted label" }],
			}),
			{ userId: "user-1", deviceId: "device-1" },
		);

		socketHandlers["sessions:discovered"]?.({
			sessions: [
				{
					sessionId: "trusted-backend-label",
					cwd: "/repo",
				},
			],
			backendId: "backend-1",
			backendLabel: "Spoofed label",
		});

		expect(
			registry
				.getCliBySocketId(socket.id)
				?.sessions.find(
					(session) => session.sessionId === "trusted-backend-label",
				)?.backendLabel,
		).toBe("Trusted label");
	});

	it("preserves additional directories when mapping discovered sessions", () => {
		registry.register(
			socket,
			createMockRegistrationInfo({ machineId: "machine-1" }),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);

		socketHandlers["sessions:discovered"]?.({
			sessions: [
				{
					sessionId: "discovered-roots",
					cwd: "/repo",
					additionalDirectories: ["/shared", "/data"],
					title: "Discovered roots",
					_meta: { source: "agent", keep: null },
				},
			],
			capabilities: {
				list: true,
				load: true,
				resume: true,
				additionalDirectories: true,
			},
			backendId: "backend-1",
			backendLabel: "Claude Code",
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"sessions:changed",
			expect.objectContaining({
				added: [
					expect.objectContaining({
						sessionId: "discovered-roots",
						additionalDirectories: ["/shared", "/data"],
						_meta: { source: "agent", keep: null },
					}),
				],
			}),
			"user-1",
		);
	});

	it("emits refreshed metadata for a previously discovered session", () => {
		registry.register(
			socket,
			createMockRegistrationInfo({ machineId: "machine-1" }),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);
		const initial = {
			sessions: [
				{
					sessionId: "discovered-refresh",
					cwd: "/repo",
					title: "Initial title",
					updatedAt: "2026-07-01T00:00:00.000Z",
					_meta: { version: 1 },
				},
			],
			backendId: "backend-1",
			backendLabel: "Claude Code",
		};
		socketHandlers["sessions:discovered"]?.(initial);
		emitToWebui.mockClear();

		socketHandlers["sessions:discovered"]?.({
			...initial,
			sessions: [
				{
					...initial.sessions[0],
					title: "Refreshed title",
					updatedAt: "2026-07-02T00:00:00.000Z",
					_meta: { version: 2 },
				},
			],
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"sessions:changed",
			expect.objectContaining({
				added: [],
				updated: [
					expect.objectContaining({
						sessionId: "discovered-refresh",
						title: "Refreshed title",
						updatedAt: "2026-07-02T00:00:00.000Z",
						_meta: { version: 2 },
					}),
				],
			}),
			"user-1",
		);
	});

	it("uses a stable timestamp when a discovered session has no agent time", () => {
		registry.register(
			socket,
			createMockRegistrationInfo({ machineId: "machine-1" }),
			{
				userId: "user-1",
				deviceId: "device-123",
			},
		);

		socketHandlers["sessions:discovered"]?.({
			sessions: [
				{
					sessionId: "without-agent-time",
					cwd: "/repo",
					updatedAt: null,
				},
			],
			backendId: "backend-1",
			backendLabel: "Claude Code",
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"sessions:changed",
			expect.objectContaining({
				added: [
					expect.objectContaining({
						sessionId: "without-agent-time",
						createdAt: expect.any(String),
						updatedAt: expect.any(String),
					}),
				],
			}),
			"user-1",
		);
		const discovered = registry
			.getCliBySocketId("socket-1")
			?.sessions.find((session) => session.sessionId === "without-agent-time");
		expect(discovered?.updatedAt).not.toBe("1970-01-01T00:00:00.000Z");
		expect(discovered?.createdAt).toBe(discovered?.updatedAt);
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

	it("echoes the session incarnation when acknowledging a WAL event", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:event"]?.({
			sessionId: "session-incarnation",
			machineId: "machine-1",
			incarnationGeneration: 4,
			revision: 1,
			seq: 3,
			kind: "agent_message_chunk",
			createdAt: "2026-07-16T00:00:00.000Z",
			payload: { text: "current" },
		});

		expect(socket.emit).toHaveBeenCalledWith("events:ack", {
			sessionId: "session-incarnation",
			incarnationGeneration: 4,
			revision: 1,
			upToSeq: 3,
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

	it("disconnects when pre-registration payload bytes exceed the queue budget", async () => {
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
		for (let seq = 1; seq <= 5; seq += 1) {
			socketHandlers["session:event"]?.({
				sessionId: "session-byte-flood",
				machineId: "machine-1",
				revision: 1,
				seq,
				kind: "agent_message_chunk",
				createdAt: "2026-07-16T00:00:00.000Z",
				payload: { text: "x".repeat(1024 * 1024) },
			});
		}
		finishUpsert?.({ machineId: "machine-1", userId: "user-1" });
		await Promise.resolve();
		await Promise.resolve();

		expect(socket.disconnect).toHaveBeenCalledWith(true);
		expect(socket.emit).toHaveBeenCalledWith("cli:error", {
			code: "REGISTRATION_BACKPRESSURE",
			message: "Registration event buffer exceeded its byte limit.",
		});
		expect(emitToWebui).not.toHaveBeenCalledWith(
			"session:event",
			expect.anything(),
			expect.anything(),
		);
	});

	it("disconnects on an unserializable pre-registration payload", async () => {
		let finishUpsert:
			| ((value: { machineId: string; userId: string }) => void)
			| undefined;
		vi.mocked(upsertMachine).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishUpsert = resolve;
				}),
		);

		socketHandlers["cli:register"]?.(createMockRegistrationInfo());
		const payload: Record<string, unknown> = {
			sessionId: "session-cyclic",
			revision: 1,
			seq: 1,
			kind: "agent_message_chunk",
			createdAt: "2026-07-16T00:00:00.000Z",
		};
		payload.payload = payload;
		socketHandlers["session:event"]?.(payload);
		finishUpsert?.({ machineId: "machine-1", userId: "user-1" });
		await Promise.resolve();
		await Promise.resolve();

		expect(socket.disconnect).toHaveBeenCalledWith(true);
		expect(socket.emit).toHaveBeenCalledWith("cli:error", {
			code: "INVALID_EVENT_PAYLOAD",
			message: "Event payload must be JSON serializable.",
		});
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

	it("sanitizes permission metadata before relaying or notifying", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["permission:request"]?.({
			sessionId: "session-1",
			requestId: "request-1",
			options: [],
			toolCall: {
				toolCallId: "tool-1",
				title: "Preserved title",
				_meta: JSON.parse('{"constructor":{"polluted":true}}'),
			},
		});

		const expected = expect.objectContaining({
			sessionId: "session-1",
			toolCall: { toolCallId: "tool-1", title: "Preserved title" },
		});
		expect(emitToWebui).toHaveBeenCalledWith(
			"permission:request",
			expected,
			"user-1",
		);
		expect(notificationService.notifyPermissionRequest).toHaveBeenCalledWith(
			"user-1",
			expected,
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

	it("sanitizes plaintext event metadata before relay and acknowledgment", () => {
		const info = createMockRegistrationInfo({ machineId: "machine-1" });
		registry.register(socket, info, {
			userId: "user-1",
			deviceId: "device-123",
		});

		socketHandlers["session:event"]?.({
			sessionId: "session-1",
			revision: 1,
			seq: 9,
			kind: "session_update",
			createdAt: new Date().toISOString(),
			payload: {
				update: {
					sessionUpdate: "session_info_update",
					title: "Preserved title",
					_meta: { value: Number.NaN },
				},
			},
		});

		expect(emitToWebui).toHaveBeenCalledWith(
			"session:event",
			expect.objectContaining({
				payload: {
					update: {
						sessionUpdate: "session_info_update",
						title: "Preserved title",
					},
				},
			}),
			"user-1",
		);
		expect(socket.emit).toHaveBeenCalledWith("events:ack", {
			sessionId: "session-1",
			revision: 1,
			upToSeq: 9,
		});
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

	it("keeps Team relay gated until canonical identity binding is proven", async () => {
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
		let finishClaim: ((claimed: boolean) => void) | undefined;
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
			claimUser: vi.fn(
				() =>
					new Promise<boolean>((resolve) => {
						finishClaim = resolve;
					}),
			),
			releaseUser: vi.fn(async () => undefined),
		};
		const relayKey = createMockRelayKey(1);

		localHandlers["cli:register"]?.(
			createMockRegistrationInfo({
				machineId: "raw-machine-1",
				teamRelayKey: relayKey,
			}),
		);

		await vi.waitFor(() => {
			expect(affinity?.claimUser).toHaveBeenCalledWith("user-1");
			expect(localRegistry.getCliBySocketId(localSocket.id)).toBeDefined();
		});
		const record = localRegistry.getCliBySocketId(localSocket.id);
		if (!record?.teamRelayRegistrationId) {
			throw new Error("Missing Team relay registration proof");
		}
		expect(record.teamRelayReady).toBe(false);
		expect(localSocket.emit).not.toHaveBeenCalledWith(
			"cli:registered",
			expect.anything(),
		);

		finishClaim?.(true);
		await vi.waitFor(() => {
			expect(localSocket.emit).toHaveBeenCalledWith("cli:registered", {
				machineId: "machine-1",
				userId: "user-1",
				teamRelayRegistrationId: record.teamRelayRegistrationId,
			});
		});

		localHandlers["cli:team-relay-ready"]?.({
			registrationId: record.teamRelayRegistrationId,
			relayKeyId: relayKey.keyId,
		});

		expect(record.teamRelayReady).toBe(true);
	});

	it("acknowledges Team relay readiness with the exact current proof", () => {
		const relayKey = createMockRelayKey(1);
		const record = registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-1",
				teamRelayKey: relayKey,
			}),
			{ userId: "user-1", deviceId: "device-123" },
		);
		if (!record.teamRelayRegistrationId) {
			throw new Error("Missing Team relay registration proof");
		}
		const ack = vi.fn<(response: unknown) => void>();
		const expectedAck = {
			accepted: true,
			registrationId: record.teamRelayRegistrationId,
			relayKeyId: relayKey.keyId,
		} satisfies TeamRelayReadyAck;

		socketHandlers["cli:team-relay-ready"]?.(
			{
				registrationId: record.teamRelayRegistrationId,
				relayKeyId: relayKey.keyId,
			},
			ack,
		);

		expect(ack).toHaveBeenCalledOnce();
		expect(ack).toHaveBeenCalledWith(expectedAck);
		expect(record.teamRelayReady).toBe(true);
	});

	it("rejects stale Team relay proofs without enabling the registration", () => {
		const relayKey = createMockRelayKey(1);
		const record = registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-1",
				teamRelayKey: relayKey,
			}),
			{ userId: "user-1", deviceId: "device-123" },
		);
		if (!record.teamRelayRegistrationId) {
			throw new Error("Missing Team relay registration proof");
		}
		const rejectedAck = { accepted: false } satisfies TeamRelayReadyAck;
		const staleRegistrationAck = vi.fn<(response: unknown) => void>();

		socketHandlers["cli:team-relay-ready"]?.(
			{
				registrationId: "stale-registration",
				relayKeyId: relayKey.keyId,
			},
			staleRegistrationAck,
		);

		expect(staleRegistrationAck).toHaveBeenCalledOnce();
		expect(staleRegistrationAck).toHaveBeenCalledWith(rejectedAck);
		expect(record.teamRelayReady).toBe(false);

		const staleKeyAck = vi.fn<(response: unknown) => void>();
		socketHandlers["cli:team-relay-ready"]?.(
			{
				registrationId: record.teamRelayRegistrationId,
				relayKeyId: createMockRelayKey(2).keyId,
			},
			staleKeyAck,
		);

		expect(staleKeyAck).toHaveBeenCalledOnce();
		expect(staleKeyAck).toHaveBeenCalledWith(rejectedAck);
		expect(record.teamRelayReady).toBe(false);
	});

	it("accepts Team relay readiness when the optional ACK is omitted", () => {
		const relayKey = createMockRelayKey(1);
		const record = registry.register(
			socket,
			createMockRegistrationInfo({
				machineId: "machine-1",
				teamRelayKey: relayKey,
			}),
			{ userId: "user-1", deviceId: "device-123" },
		);
		if (!record.teamRelayRegistrationId) {
			throw new Error("Missing Team relay registration proof");
		}

		expect(() => {
			socketHandlers["cli:team-relay-ready"]?.({
				registrationId: record.teamRelayRegistrationId,
				relayKeyId: relayKey.keyId,
			});
		}).not.toThrow();
		expect(record.teamRelayReady).toBe(true);
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
