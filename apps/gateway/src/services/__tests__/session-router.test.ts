import type {
	CliRegistrationInfo,
	DiscoverSessionsRpcResult,
	GitFileDiffResponse,
	GitStatusResponse,
	SessionSummary,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliRegistry } from "../cli-registry.js";
import { SessionRouter } from "../session-router.js";

// Mock the db-service module
vi.mock("../db-service.js", () => ({
	createAcpSessionDirect: vi.fn().mockResolvedValue(undefined),
	closeAcpSession: vi.fn().mockResolvedValue(undefined),
	updateAcpSessionState: vi.fn().mockResolvedValue(undefined),
}));

const createMockSocket = (
	id = `socket-${Math.random().toString(36).slice(2, 8)}`,
) => {
	const emitMock = vi.fn();
	return {
		id,
		emit: emitMock,
		on: vi.fn(),
		join: vi.fn(),
		leave: vi.fn(),
	} as unknown as Socket & { emit: ReturnType<typeof vi.fn> };
};

const createMockRegistrationInfo = (
	overrides: Partial<CliRegistrationInfo> = {},
): CliRegistrationInfo => ({
	machineId: `machine-${Math.random().toString(36).slice(2, 8)}`,
	hostname: "test-host",
	version: "1.0.0",
	backends: [{ backendId: "backend-1", backendLabel: "Claude Code" }],
	defaultBackendId: "backend-1",
	...overrides,
});

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

const createMockDiscoverResult = (): DiscoverSessionsRpcResult => ({
	sessions: [
		{
			sessionId: "discovered-session-1",
			cwd: "/home/user/project1",
			title: "Project 1",
			updatedAt: new Date().toISOString(),
		},
		{
			sessionId: "discovered-session-2",
			cwd: "/home/user/project2",
			title: "Project 2",
		},
	],
	capabilities: {
		list: true,
		load: true,
	},
});

describe("SessionRouter", () => {
	let cliRegistry: CliRegistry;
	let sessionRouter: SessionRouter;

	beforeEach(() => {
		cliRegistry = new CliRegistry();
		sessionRouter = new SessionRouter(cliRegistry);
	});

	describe("discoverSessions", () => {
		it("routes discover request to CLI and returns result", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockResult = createMockDiscoverResult();

			// Setup socket to capture the RPC call and respond
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:sessions:discover") {
					// Simulate async response
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockResult,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.discoverSessions(
				"machine-1",
				undefined,
				"user-1",
			);

			expect(result.sessions).toHaveLength(2);
			expect(result.sessions[0].sessionId).toBe("discovered-session-1");
			expect(result.capabilities.list).toBe(true);
			expect(result.capabilities.load).toBe(true);
		});

		it("throws error when no CLI connected for machine", async () => {
			await expect(
				sessionRouter.discoverSessions("unknown-machine", undefined, "user-1"),
			).rejects.toThrow("No CLI connected for this machine");
		});

		it("throws error when no CLI connected for user", async () => {
			await expect(
				sessionRouter.discoverSessions(undefined, undefined, "user-1"),
			).rejects.toThrow("No CLI connected for this user");
		});

		it("throws error when user not authorized for machine", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			await expect(
				sessionRouter.discoverSessions("machine-1", undefined, "user-2"),
			).rejects.toThrow("Not authorized to access this machine");
		});

		it("uses first CLI for user when no machineId specified", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockResult = createMockDiscoverResult();
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:sessions:discover") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockResult,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.discoverSessions(
				undefined,
				"/home/user/project",
				"user-1",
			);

			expect(result.sessions).toHaveLength(2);
			// Verify cwd was passed in the request
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:sessions:discover",
				expect.objectContaining({
					params: { cwd: "/home/user/project" },
				}),
			);
		});
	});

	describe("loadSession", () => {
		it("routes load request to CLI and returns session", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "loaded-session-1",
				title: "Session Title",
				cwd: "/home/user/project",
			});

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:load") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockSession,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.loadSession(
				{
					sessionId: "loaded-session-1",
					cwd: "/home/user/project",
					machineId: "machine-1",
				},
				"user-1",
			);

			expect(result.sessionId).toBe("loaded-session-1");
			expect(result.title).toBe("Session Title");
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:session:load",
				expect.objectContaining({
					params: {
						sessionId: "loaded-session-1",
						cwd: "/home/user/project",
					},
				}),
			);
		});

		it("throws error when no CLI connected", async () => {
			await expect(
				sessionRouter.loadSession(
					{
						sessionId: "session-1",
						cwd: "/home/user",
						machineId: "unknown-machine",
					},
					"user-1",
				),
			).rejects.toThrow("No CLI connected for this machine");
		});

		it("throws error when user not authorized for machine", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			await expect(
				sessionRouter.loadSession(
					{
						sessionId: "session-1",
						cwd: "/home/user",
						machineId: "machine-1",
					},
					"user-2",
				),
			).rejects.toThrow("Not authorized to access this machine");
		});

		it("uses first CLI for user when no machineId specified", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "loaded-session-1",
			});

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:load") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockSession,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.loadSession(
				{
					sessionId: "loaded-session-1",
					cwd: "/home/user/project",
				},
				"user-1",
			);

			expect(result.sessionId).toBe("loaded-session-1");
		});
	});

	describe("RPC error handling", () => {
		it("rejects promise when RPC returns error", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:sessions:discover") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							error: {
								code: "CAPABILITY_NOT_SUPPORTED",
								message: "Agent does not support session listing",
								retryable: false,
								scope: "session",
							},
						});
					}, 0);
				}
			});

			await expect(
				sessionRouter.discoverSessions("machine-1", undefined, "user-1"),
			).rejects.toThrow("Agent does not support session listing");
		});
	});

	describe("getGitStatus", () => {
		it("routes git status request to CLI and returns result", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			const mockResult: GitStatusResponse = {
				isGitRepo: true,
				branch: "main",
				files: [
					{ path: "src/file.ts", status: "M" },
					{ path: "src/new.ts", status: "A" },
				],
				dirStatus: { src: "A" },
			};

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:git:status") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockResult,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.getGitStatus("session-1", "user-1");

			expect(result.isGitRepo).toBe(true);
			expect(result.branch).toBe("main");
			expect(result.files).toHaveLength(2);
			expect(result.dirStatus.src).toBe("A");
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:git:status",
				expect.objectContaining({
					params: { sessionId: "session-1" },
				}),
			);
		});

		it("returns isGitRepo false for non-git directories", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			const mockResult: GitStatusResponse = {
				isGitRepo: false,
				files: [],
				dirStatus: {},
			};

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:git:status") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockResult,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.getGitStatus("session-1", "user-1");

			expect(result.isGitRepo).toBe(false);
			expect(result.branch).toBeUndefined();
		});

		it("throws error when session not found", async () => {
			await expect(
				sessionRouter.getGitStatus("unknown-session", "user-1"),
			).rejects.toThrow("Session not found");
		});

		it("throws error when user not authorized for session", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			await expect(
				sessionRouter.getGitStatus("session-1", "user-2"),
			).rejects.toThrow("Not authorized to access this session");
		});
	});

	describe("getGitFileDiff", () => {
		it("routes git file diff request to CLI and returns result", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			const mockResult: GitFileDiffResponse = {
				isGitRepo: true,
				path: "src/file.ts",
				addedLines: [5, 6, 7],
				modifiedLines: [10],
			};

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:git:fileDiff") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockResult,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.getGitFileDiff(
				{ sessionId: "session-1", path: "src/file.ts" },
				"user-1",
			);

			expect(result.isGitRepo).toBe(true);
			expect(result.path).toBe("src/file.ts");
			expect(result.addedLines).toEqual([5, 6, 7]);
			expect(result.modifiedLines).toEqual([10]);
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:git:fileDiff",
				expect.objectContaining({
					params: { sessionId: "session-1", path: "src/file.ts" },
				}),
			);
		});

		it("returns empty arrays for non-git directories", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			const mockResult: GitFileDiffResponse = {
				isGitRepo: false,
				path: "src/file.ts",
				addedLines: [],
				modifiedLines: [],
			};

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:git:fileDiff") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: mockResult,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.getGitFileDiff(
				{ sessionId: "session-1", path: "src/file.ts" },
				"user-1",
			);

			expect(result.isGitRepo).toBe(false);
			expect(result.addedLines).toEqual([]);
		});

		it("throws error when session not found", async () => {
			await expect(
				sessionRouter.getGitFileDiff(
					{ sessionId: "unknown-session", path: "src/file.ts" },
					"user-1",
				),
			).rejects.toThrow("Session not found");
		});

		it("throws error when user not authorized for session", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			await expect(
				sessionRouter.getGitFileDiff(
					{ sessionId: "session-1", path: "src/file.ts" },
					"user-2",
				),
			).rejects.toThrow("Not authorized to access this session");
		});
	});
});
