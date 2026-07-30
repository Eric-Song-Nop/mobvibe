import type {
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionEvent,
} from "@mobvibe/shared";
import type { Server, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliRegistry } from "../../services/cli-registry.js";
import { setupWebuiHandlers } from "../webui-handlers.js";

const { mockGetSession } = vi.hoisted(() => ({
	mockGetSession: vi.fn(),
}));

vi.mock("../../lib/auth.js", () => ({
	auth: {
		api: {
			getSession: mockGetSession,
		},
	},
}));

vi.mock("../../lib/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

describe("webui-handlers auth middleware", () => {
	let authMiddleware: (socket: unknown, next: unknown) => Promise<void>;

	beforeEach(() => {
		vi.clearAllMocks();

		let capturedMiddleware:
			| ((socket: unknown, next: unknown) => Promise<void>)
			| undefined;

		const namespace = {
			use: vi.fn((mw: (socket: unknown, next: unknown) => Promise<void>) => {
				capturedMiddleware = mw;
			}),
			on: vi.fn(),
			sockets: new Map(),
		};

		const io = {
			of: vi.fn(() => namespace),
		} as unknown as Server;

		const mockCliRegistry = {
			onCliStatus: vi.fn(),
			on: vi.fn(),
			onSessionsChanged: vi.fn(),
		} as unknown as CliRegistry;

		setupWebuiHandlers(io, mockCliRegistry);

		if (!capturedMiddleware) {
			throw new Error("Middleware was not captured during setup");
		}
		authMiddleware = capturedMiddleware;
	});

	it("authenticates with valid Bearer token", async () => {
		mockGetSession.mockResolvedValue({
			user: { id: "user-1", email: "user@example.com" },
		});
		const socket = {
			id: "socket-1",
			handshake: {
				auth: { token: "valid-bearer-token" },
				query: {},
				headers: {},
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		expect(mockGetSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
		});
		// Verify Bearer was set
		const callHeaders = mockGetSession.mock.calls[0][0].headers as Headers;
		expect(callHeaders.get("authorization")).toBe("Bearer valid-bearer-token");
		expect(socket.data.userId).toBe("user-1");
		expect(socket.data.userEmail).toBe("user@example.com");
		expect(next).toHaveBeenCalledWith();
	});

	it("authenticates with valid cookie when no token", async () => {
		mockGetSession.mockResolvedValue({
			user: { id: "user-2", email: "cookie@example.com" },
		});
		const socket = {
			id: "socket-2",
			handshake: {
				auth: {},
				query: {},
				headers: { cookie: "session=abc123" },
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		const callHeaders = mockGetSession.mock.calls[0][0].headers as Headers;
		expect(callHeaders.get("cookie")).toBe("session=abc123");
		expect(callHeaders.get("authorization")).toBeNull();
		expect(socket.data.userId).toBe("user-2");
		expect(next).toHaveBeenCalledWith();
	});

	it("prefers Bearer token over cookie when both present", async () => {
		mockGetSession.mockResolvedValue({
			user: { id: "user-3", email: "both@example.com" },
		});
		const socket = {
			id: "socket-3",
			handshake: {
				auth: { token: "bearer-token" },
				query: {},
				headers: { cookie: "session=abc123" },
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		const callHeaders = mockGetSession.mock.calls[0][0].headers as Headers;
		expect(callHeaders.get("authorization")).toBe("Bearer bearer-token");
		// Cookie should NOT be set when token is present
		expect(callHeaders.get("cookie")).toBeNull();
		expect(next).toHaveBeenCalledWith();
	});

	it("authenticates with bearer token from query when auth payload is unavailable", async () => {
		mockGetSession.mockResolvedValue({
			user: { id: "user-4", email: "query@example.com" },
		});
		const socket = {
			id: "socket-query",
			handshake: {
				auth: {},
				query: { bearerToken: "query-token" },
				headers: {},
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		const callHeaders = mockGetSession.mock.calls[0][0].headers as Headers;
		expect(callHeaders.get("authorization")).toBe("Bearer query-token");
		expect(socket.data.userId).toBe("user-4");
		expect(next).toHaveBeenCalledWith();
	});

	it("rejects when no token and no cookie", async () => {
		const socket = {
			id: "socket-4",
			handshake: {
				auth: {},
				query: {},
				headers: {},
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		expect(mockGetSession).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledWith(expect.any(Error));
		expect((next.mock.calls[0][0] as Error).message).toBe("AUTH_REQUIRED");
	});

	it("rejects when getSession returns null", async () => {
		mockGetSession.mockResolvedValue(null);
		const socket = {
			id: "socket-5",
			handshake: {
				auth: { token: "expired-token" },
				query: {},
				headers: {},
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		expect(next).toHaveBeenCalledWith(expect.any(Error));
		expect((next.mock.calls[0][0] as Error).message).toBe("AUTH_REQUIRED");
	});

	it("rejects when getSession returns session without user", async () => {
		mockGetSession.mockResolvedValue({ user: null });
		const socket = {
			id: "socket-6",
			handshake: {
				auth: { token: "bad-token" },
				query: {},
				headers: {},
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		expect(next).toHaveBeenCalledWith(expect.any(Error));
		expect((next.mock.calls[0][0] as Error).message).toBe("AUTH_REQUIRED");
	});

	it("rejects when getSession throws an exception", async () => {
		mockGetSession.mockRejectedValue(new Error("DB connection failed"));
		const socket = {
			id: "socket-7",
			handshake: {
				auth: { token: "some-token" },
				query: {},
				headers: {},
			},
			data: {} as Record<string, unknown>,
		};
		const next = vi.fn();

		await authMiddleware(socket, next);

		expect(next).toHaveBeenCalledWith(expect.any(Error));
		expect((next.mock.calls[0][0] as Error).message).toBe("AUTH_REQUIRED");
	});
});

describe("webui-handlers subscriber isolation", () => {
	it("does not relay colliding session events or permissions across users", () => {
		const socketHandlers = new Map<
			string,
			Record<string, (payload: { sessionId: string }) => void>
		>();
		const createSocket = (socketId: string, userId: string) => {
			const handlers: Record<string, (payload: { sessionId: string }) => void> =
				{};
			socketHandlers.set(socketId, handlers);
			return {
				id: socketId,
				data: { userId, userEmail: `${userId}@example.com` },
				handshake: { auth: {}, query: {}, headers: {} },
				on: vi.fn(
					(
						event: string,
						handler: (payload: { sessionId: string }) => void,
					) => {
						handlers[event] = handler;
					},
				),
				emit: vi.fn(),
				disconnect: vi.fn(),
			};
		};

		const userOneSocket = createSocket("socket-user-1", "user-1");
		const userTwoSocket = createSocket("socket-user-2", "user-2");
		const sockets = new Map<string, Socket>([
			[userOneSocket.id, userOneSocket as unknown as Socket],
			[userTwoSocket.id, userTwoSocket as unknown as Socket],
		]);
		let connectionHandler: ((socket: Socket) => void) | undefined;
		const namespace = {
			use: vi.fn(),
			on: vi.fn((event: string, handler: (socket: Socket) => void) => {
				if (event === "connection") connectionHandler = handler;
			}),
			sockets,
		};
		const io = {
			of: vi.fn(() => namespace),
		} as unknown as Server;
		const mockCliRegistry = {
			onCliStatus: vi.fn(),
			on: vi.fn(),
			onSessionsChanged: vi.fn(),
			getClisForUser: vi.fn(() => []),
			isSessionOwnedByUser: vi.fn(() => true),
		} as unknown as CliRegistry;

		const emitter = setupWebuiHandlers(io, mockCliRegistry);
		connectionHandler?.(userOneSocket as unknown as Socket);
		connectionHandler?.(userTwoSocket as unknown as Socket);
		socketHandlers
			.get(userOneSocket.id)
			?.["subscribe:session"]?.({ sessionId: "colliding-session" });
		socketHandlers
			.get(userTwoSocket.id)
			?.["subscribe:session"]?.({ sessionId: "colliding-session" });

		const sessionEvent: SessionEvent = {
			sessionId: "colliding-session",
			machineId: "machine-1",
			revision: 1,
			seq: 1,
			kind: "user_message",
			createdAt: "2026-07-16T00:00:00.000Z",
			payload: {},
		};
		const permissionRequest: PermissionRequestPayload = {
			sessionId: "colliding-session",
			requestId: "permission-1",
			options: [],
		};
		const permissionResult: PermissionDecisionPayload = {
			sessionId: "colliding-session",
			requestId: "permission-1",
			outcome: { outcome: "cancelled" },
		};
		const userScopedEmitter = emitter as typeof emitter & {
			emitSessionEvent: (event: SessionEvent, userId: string) => void;
			emitPermissionRequest: (
				payload: PermissionRequestPayload,
				userId: string,
			) => void;
			emitPermissionResult: (
				payload: PermissionDecisionPayload,
				userId: string,
			) => void;
		};

		userScopedEmitter.emitSessionEvent(sessionEvent, "user-1");
		userScopedEmitter.emitPermissionRequest(permissionRequest, "user-1");
		userScopedEmitter.emitPermissionResult(permissionResult, "user-1");

		expect(userOneSocket.emit).toHaveBeenCalledWith(
			"session:event",
			sessionEvent,
		);
		expect(userOneSocket.emit).toHaveBeenCalledWith(
			"permission:request",
			permissionRequest,
		);
		expect(userOneSocket.emit).toHaveBeenCalledWith(
			"permission:result",
			permissionResult,
		);
		expect(userTwoSocket.emit).not.toHaveBeenCalled();

		const diagnosticEmitter = emitter as typeof emitter & {
			getTrackedSessionCount: () => number;
		};
		expect(diagnosticEmitter.getTrackedSessionCount()).toBe(1);
		socketHandlers
			.get(userOneSocket.id)
			?.["unsubscribe:session"]?.({ sessionId: "colliding-session" });
		expect(diagnosticEmitter.getTrackedSessionCount()).toBe(1);
		socketHandlers
			.get(userTwoSocket.id)
			?.["unsubscribe:session"]?.({ sessionId: "colliding-session" });
		expect(diagnosticEmitter.getTrackedSessionCount()).toBe(0);

		socketHandlers
			.get(userOneSocket.id)
			?.["subscribe:session"]?.({ sessionId: "session-a" });
		socketHandlers
			.get(userOneSocket.id)
			?.["subscribe:session"]?.({ sessionId: "session-b" });
		expect(diagnosticEmitter.getTrackedSessionCount()).toBe(2);
		socketHandlers
			.get(userOneSocket.id)
			?.disconnect?.({ sessionId: "ignored" });
		expect(diagnosticEmitter.getTrackedSessionCount()).toBe(0);
	});

	it("uses user affinity initialized after handlers are installed", () => {
		let connectionHandler: ((socket: Socket) => void) | undefined;
		const socketHandlers: Record<string, () => void> = {};
		const namespace = {
			use: vi.fn(),
			on: vi.fn((event: string, handler: (socket: Socket) => void) => {
				if (event === "connection") connectionHandler = handler;
			}),
			sockets: new Map(),
		};
		const io = { of: vi.fn(() => namespace) } as unknown as Server;
		const mockCliRegistry = {
			onCliStatus: vi.fn(),
			on: vi.fn(),
			onSessionsChanged: vi.fn(),
			getClisForUser: vi.fn(() => []),
		} as unknown as CliRegistry;
		let affinity: {
			claimUser: ReturnType<typeof vi.fn>;
			releaseUser: ReturnType<typeof vi.fn>;
		} | null = null;
		setupWebuiHandlers(io, mockCliRegistry, (() => affinity) as never);
		affinity = {
			claimUser: vi.fn(async () => true),
			releaseUser: vi.fn(async () => undefined),
		};
		const socket = {
			id: "socket-late-affinity",
			data: { userId: "user-1", userEmail: "user@example.com" },
			handshake: { auth: {}, query: {}, headers: {} },
			on: vi.fn((event: string, handler: () => void) => {
				socketHandlers[event] = handler;
			}),
			emit: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as Socket;

		connectionHandler?.(socket);

		expect(affinity.claimUser).toHaveBeenCalledWith("user-1");
		socketHandlers.disconnect?.();
		expect(affinity.releaseUser).not.toHaveBeenCalled();
	});

	it("atomically claims affinity before accepting a WebUI connection", async () => {
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
			sockets: new Map(),
		};
		const io = { of: vi.fn(() => namespace) } as unknown as Server;
		const mockCliRegistry = {
			onCliStatus: vi.fn(),
			on: vi.fn(),
			onSessionsChanged: vi.fn(),
		} as unknown as CliRegistry;
		const affinity = {
			claimUser: vi.fn(async () => false),
			getUserInstance: vi.fn(async () => ({
				instanceId: "instance-owner",
				region: "ord",
			})),
			releaseUser: vi.fn(),
		};
		setupWebuiHandlers(io, mockCliRegistry, () => affinity as never);
		mockGetSession.mockResolvedValue({
			user: { id: "user-1", email: "user@example.com" },
		});
		const socket = {
			id: "socket-affinity-race",
			handshake: {
				auth: { token: "valid-bearer-token" },
				query: {},
				headers: {},
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
