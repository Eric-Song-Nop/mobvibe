import type { Server } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliRegistry } from "../../services/cli-registry.js";
import type { SessionRouter } from "../../services/session-router.js";
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
	let authMiddleware: (socket: any, next: any) => Promise<void>;

	beforeEach(() => {
		vi.clearAllMocks();

		let capturedMiddleware:
			| ((socket: any, next: any) => Promise<void>)
			| undefined;

		const namespace = {
			use: vi.fn((mw: (socket: any, next: any) => Promise<void>) => {
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

		const mockSessionRouter = {} as unknown as SessionRouter;

		setupWebuiHandlers(io, mockCliRegistry, mockSessionRouter);

		authMiddleware = capturedMiddleware!;
	});

	it("authenticates with valid Bearer token", async () => {
		mockGetSession.mockResolvedValue({
			user: { id: "user-1", email: "user@example.com" },
		});
		const socket = {
			id: "socket-1",
			handshake: {
				auth: { token: "valid-bearer-token" },
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

	it("rejects when no token and no cookie", async () => {
		const socket = {
			id: "socket-4",
			handshake: {
				auth: {},
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
