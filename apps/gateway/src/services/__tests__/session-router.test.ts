import type {
	AppError,
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
		prompt: {
			image: true,
			audio: false,
			embeddedContext: false,
		},
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
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
			expect(result.capabilities.prompt?.image).toBe(true);
		});

		it("throws error when no CLI connected for machine", async () => {
			await expect(
				sessionRouter.discoverSessions("unknown-machine", undefined, "user-1"),
			).rejects.toThrow("Machine not found");
		});

		it("throws error when no CLI connected for user", async () => {
			await expect(
				sessionRouter.discoverSessions(undefined, undefined, "user-1"),
			).rejects.toThrow("No CLI connected for this user");
		});

		it("throws 'Machine not found' when user not authorized for machine", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			cliRegistry.register(socket, info, authInfo);

			await expect(
				sessionRouter.discoverSessions("machine-1", undefined, "user-2"),
			).rejects.toThrow("Machine not found");
		});

		it("uses first CLI for user when no machineId specified", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
					params: expect.objectContaining({
						cwd: "/home/user/project",
					}),
				}),
			);
		});

		it("forwards backendId to discover RPC", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
				"machine-1",
				"/home/user/project",
				"user-1",
				undefined,
				"codex-acp",
			);

			expect(result.sessions).toHaveLength(2);
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:sessions:discover",
				expect.objectContaining({
					params: expect.objectContaining({
						cwd: "/home/user/project",
						backendId: "codex-acp",
					}),
				}),
			);
		});
	});

	describe("loadSession", () => {
		it("routes load request to CLI and returns session", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
					additionalDirectories: ["/data", "/shared"],
					machineId: "machine-1",
					backendId: "backend-1",
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
						additionalDirectories: ["/data", "/shared"],
						backendId: "backend-1",
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
						backendId: "backend-1",
					},
					"user-1",
				),
			).rejects.toThrow("Machine not found");
		});

		it("throws 'Machine not found' when user not authorized for machine", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			cliRegistry.register(socket, info, authInfo);

			await expect(
				sessionRouter.loadSession(
					{
						sessionId: "session-1",
						cwd: "/home/user",
						machineId: "machine-1",
						backendId: "backend-1",
					},
					"user-2",
				),
			).rejects.toThrow("Machine not found");
		});

		it("uses first CLI for user when no machineId specified", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
					backendId: "backend-1",
				},
				"user-1",
			);

			expect(result.sessionId).toBe("loaded-session-1");
		});
	});

	describe("resumeSession", () => {
		it("routes resume to the owning user machine with the complete request", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			cliRegistry.register(socket, info, {
				userId: "user-1",
				deviceId: "device-123",
			});
			const summary = createMockSessionSummary({
				sessionId: "session-1",
				cwd: "/repo",
			});
			cliRegistry.updateSessions(socket.id, [summary]);
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:resume") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: summary,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.resumeSession(
				{
					sessionId: "session-1",
					cwd: "/repo",
					additionalDirectories: ["/data"],
					backendId: "backend-1",
					machineId: "machine-1",
				},
				"user-1",
			);

			expect(result.sessionId).toBe("session-1");
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:session:resume",
				expect.objectContaining({
					params: {
						sessionId: "session-1",
						cwd: "/repo",
						additionalDirectories: ["/data"],
						backendId: "backend-1",
						machineId: "machine-1",
					},
				}),
			);
		});

		it("does not route an owned session to a different machine", async () => {
			const ownerSocket = createMockSocket("socket-owner");
			const otherSocket = createMockSocket("socket-other");
			cliRegistry.register(
				ownerSocket,
				createMockRegistrationInfo({ machineId: "machine-owner" }),
				{ userId: "user-1", deviceId: "device-owner" },
			);
			cliRegistry.register(
				otherSocket,
				createMockRegistrationInfo({ machineId: "machine-other" }),
				{ userId: "user-1", deviceId: "device-other" },
			);
			cliRegistry.updateSessions(ownerSocket.id, [
				createMockSessionSummary({ sessionId: "session-owned" }),
			]);

			await expect(
				sessionRouter.resumeSession(
					{
						sessionId: "session-owned",
						cwd: "/repo",
						backendId: "backend-1",
						machineId: "machine-other",
					},
					"user-1",
				),
			).rejects.toThrow("Session not found");
			expect(otherSocket.emit).not.toHaveBeenCalled();
		});
	});

	describe("archiveSession", () => {
		it("sends archive RPC to CLI", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:archive") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: { ok: true },
						});
					}, 0);
				}
			});

			const result = await sessionRouter.archiveSession(
				{ sessionId: "session-1" },
				"user-1",
			);

			expect(result).toEqual({ ok: true });
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:session:archive",
				expect.objectContaining({
					params: { sessionId: "session-1" },
				}),
			);
		});

		it("throws when session is not found in registry", async () => {
			await expect(
				sessionRouter.archiveSession(
					{ sessionId: "detached-session" },
					"user-1",
				),
			).rejects.toThrow("Session not found");
		});
	});

	describe("closeSession", () => {
		it("routes protocol close and keeps the session as detached", async () => {
			const socket = createMockSocket("socket-close");
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-close" }),
				{ userId: "user-close", deviceId: "device-close" },
			);
			cliRegistry.updateSessions(socket.id, [
				createMockSessionSummary({
					sessionId: "session-close",
					isAttached: true,
				}),
			]);
			const detached = createMockSessionSummary({
				sessionId: "session-close",
				isAttached: false,
			});
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:close") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: detached,
						});
					}, 0);
				}
			});

			const result = await sessionRouter.closeSession(
				{ sessionId: "session-close" },
				"user-close",
			);

			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:session:close",
				expect.objectContaining({
					params: { sessionId: "session-close" },
				}),
			);
			expect(result).toEqual({ ...detached, machineId: "machine-close" });
		});

		it("rejects a close request from another user without sending RPC", async () => {
			const socket = createMockSocket("socket-close-private");
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-close-private" }),
				{ userId: "owner", deviceId: "device-owner" },
			);
			cliRegistry.updateSessions(socket.id, [
				createMockSessionSummary({ sessionId: "session-private" }),
			]);

			await expect(
				sessionRouter.closeSession(
					{ sessionId: "session-private" },
					"other-user",
				),
			).rejects.toThrow("Session not found");
			expect(socket.emit).not.toHaveBeenCalledWith(
				"rpc:session:close",
				expect.anything(),
			);
		});
	});

	describe("setSessionConfigOption", () => {
		it("routes a protocol-native config update to the session owner's CLI", async () => {
			const socket = createMockSocket("socket-config");
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-config" }),
				{ userId: "user-config", deviceId: "device-config" },
			);
			cliRegistry.updateSessions(socket.id, [
				createMockSessionSummary({ sessionId: "session-config" }),
			]);
			const updatedSession = createMockSessionSummary({
				sessionId: "session-config",
			});

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:config") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: updatedSession,
						});
					}, 0);
				}
			});

			await expect(
				sessionRouter.setSessionConfigOption(
					{
						sessionId: "session-config",
						configId: "auto-approve",
						type: "boolean",
						value: true,
					},
					"user-config",
				),
			).resolves.toEqual(updatedSession);
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:session:config",
				expect.objectContaining({
					params: {
						sessionId: "session-config",
						configId: "auto-approve",
						type: "boolean",
						value: true,
					},
				}),
			);
		});

		it("does not route config updates across users", async () => {
			const socket = createMockSocket("socket-config-owner");
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-config-owner" }),
				{ userId: "owner", deviceId: "device-owner" },
			);
			cliRegistry.updateSessions(socket.id, [
				createMockSessionSummary({ sessionId: "private-session" }),
			]);

			await expect(
				sessionRouter.setSessionConfigOption(
					{
						sessionId: "private-session",
						configId: "model",
						value: "secret-model",
					},
					"attacker",
				),
			).rejects.toThrow("Session not found");
			expect(socket.emit).not.toHaveBeenCalled();
		});
	});

	describe("bulkArchiveSessions", () => {
		it("sends archive-all RPC grouped by machine", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			cliRegistry.register(socket, info, authInfo);

			const sessions = [
				createMockSessionSummary({ sessionId: "session-1" }),
				createMockSessionSummary({ sessionId: "session-2" }),
			];
			cliRegistry.updateSessions(socket.id, sessions);

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:archive-all") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: { archivedCount: request.params.sessionIds.length },
						});
					}, 0);
				}
			});

			const result = await sessionRouter.bulkArchiveSessions(
				["session-1", "session-2"],
				"user-1",
			);

			expect(result).toEqual({ archivedCount: 2 });
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:session:archive-all",
				expect.objectContaining({
					params: {
						sessionIds: expect.arrayContaining(["session-1", "session-2"]),
					},
				}),
			);
		});

		it("falls back to first CLI when session not in registry", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			cliRegistry.register(socket, info, authInfo);

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:session:archive-all") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							result: { archivedCount: request.params.sessionIds.length },
						});
					}, 0);
				}
			});

			const result = await sessionRouter.bulkArchiveSessions(
				["unknown-1", "unknown-2"],
				"user-1",
			);

			expect(result).toEqual({ archivedCount: 2 });
		});
	});

	describe("sendMessage safety and in-flight deduplication", () => {
		const registerSession = (
			protocolCapabilities?: {
				messageIdempotency?: boolean;
				messageRevisionPinning?: boolean;
			},
			sessionOverrides: Parameters<typeof createMockSessionSummary>[0] = {},
		) => {
			const socket = createMockSocket("socket-message");
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({
					machineId: "machine-message",
					protocolCapabilities,
				}),
				{ userId: "user-message", deviceId: "device-message" },
			);
			cliRegistry.updateSessions(socket.id, [
				createMockSessionSummary({
					sessionId: "session-message",
					...sessionOverrides,
				}),
			]);
			return socket;
		};
		const registerOwnedSession = ({
			userId,
			machineId,
			sessionId,
			protocolCapabilities,
			revision,
		}: {
			userId: string;
			machineId: string;
			sessionId: string;
			protocolCapabilities?: {
				messageIdempotency?: boolean;
				messageRevisionPinning?: boolean;
			};
			revision?: number;
		}) => {
			const socket = createMockSocket(`socket-${machineId}`);
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({ machineId, protocolCapabilities }),
				{ userId, deviceId: `device-${machineId}` },
			);
			cliRegistry.updateSessions(socket.id, [
				createMockSessionSummary({ sessionId, revision }),
			]);
			return socket;
		};
		const getDurableMessageSendCache = () =>
			(
				sessionRouter as unknown as {
					durableMessageSends: Map<
						string,
						{
							promise: Promise<{ stopReason: "end_turn" }>;
							ownerId: string;
						}
					>;
				}
			).durableMessageSends;
		it("rejects message IDs over 128 UTF-8 bytes at the router boundary", async () => {
			const overlongMessageId = "界".repeat(43);
			expect(Buffer.byteLength(overlongMessageId, "utf8")).toBe(129);
			const error = await sessionRouter
				.sendMessage(
					{
						sessionId: "session-message",
						messageId: overlongMessageId,
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				)
				.catch((caught: unknown) => caught as AppError);

			expect(error).toMatchObject({
				status: 400,
				detail: { code: "REQUEST_VALIDATION_FAILED", retryable: false },
			});
		});

		it("uses a fixed-length digest instead of the raw message ID as the cache key", async () => {
			const socket = registerSession({ messageIdempotency: true });
			const rawMessageId = "sensitive-client-message-id";
			const operation = sessionRouter.sendMessage(
				{
					sessionId: "session-message",
					messageId: rawMessageId,
					prompt: { t: "encrypted", c: "ciphertext" },
				},
				"user-message",
			);

			const keys = [...getDurableMessageSendCache().keys()];
			expect(keys).toHaveLength(1);
			expect(keys[0]).toMatch(/^message-send:[0-9a-f]{64}$/);
			expect(keys[0]).not.toContain(rawMessageId);

			sessionRouter.handleCliDisconnect(socket.id);
			await expect(operation).rejects.toThrow("CLI disconnected");
		});

		it("rejects a CLI without durable message ID support before execution", async () => {
			const socket = registerSession();
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { stopReason: "end_turn" },
					});
				}
			});

			const error = await sessionRouter
				.sendMessage(
					{
						sessionId: "session-message",
						messageId: "legacy-unsafe-message",
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				)
				.catch((caught: unknown) => caught as AppError);

			expect(error).toMatchObject({
				status: 409,
				detail: { code: "CAPABILITY_NOT_SUPPORTED", retryable: false },
			});
			expect(socket.emit).not.toHaveBeenCalled();
			expect(getDurableMessageSendCache().size).toBe(0);
		});

		it("shares an in-flight send for a durable CLI", async () => {
			const socket = registerSession({ messageIdempotency: true });
			let requestId: string | undefined;
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") requestId = request.requestId;
			});
			const params = {
				sessionId: "session-message",
				messageId: "stable-message",
				prompt: { t: "encrypted" as const, c: "ciphertext" },
			};

			const first = sessionRouter.sendMessage(params, "user-message");
			const inFlightRetry = sessionRouter.sendMessage(params, "user-message");
			expect(socket.emit).toHaveBeenCalledTimes(1);
			sessionRouter.handleRpcResponse({
				requestId: requestId ?? "missing",
				result: { stopReason: "end_turn" },
			});

			await expect(first).resolves.toEqual({ stopReason: "end_turn" });
			await expect(inFlightRetry).resolves.toEqual({ stopReason: "end_turn" });
			expect(socket.emit).toHaveBeenCalledTimes(1);
			expect(getDurableMessageSendCache().size).toBe(0);
		});

		it("rejects a plaintext downgrade for a session that advertises E2EE", async () => {
			const socket = registerSession(
				{ messageIdempotency: true },
				{ wrappedDek: "wrapped-dek" },
			);

			const error = await sessionRouter
				.sendMessage(
					{
						sessionId: "session-message",
						messageId: "plaintext-downgrade",
						prompt: [{ type: "text", text: "must remain encrypted" }],
					},
					"user-message",
				)
				.catch((caught: unknown) => caught as AppError);

			expect(error).toMatchObject({
				status: 400,
				detail: { code: "REQUEST_VALIDATION_FAILED", retryable: false },
			});
			expect(socket.emit).not.toHaveBeenCalled();
		});

		it("rejects a pinned send when the CLI cannot enforce its revision", async () => {
			const socket = registerSession(
				{ messageIdempotency: true },
				{ revision: 4 },
			);
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { stopReason: "end_turn" },
					});
				}
			});

			const error = await sessionRouter
				.sendMessage(
					{
						sessionId: "session-message",
						messageId: "unsupported-revision-pin",
						expectedRevision: 4,
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				)
				.catch((caught: unknown) => caught as AppError);

			expect(error).toMatchObject({
				status: 409,
				detail: { code: "CAPABILITY_NOT_SUPPORTED", retryable: false },
			});
			expect(socket.emit).not.toHaveBeenCalled();
		});

		it("rejects an invalid expected revision at the router boundary", async () => {
			const socket = registerSession(
				{
					messageIdempotency: true,
					messageRevisionPinning: true,
				},
				{ revision: 4 },
			);

			const error = await sessionRouter
				.sendMessage(
					{
						sessionId: "session-message",
						messageId: "invalid-revision-pin",
						expectedRevision: 1.5,
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				)
				.catch((caught: unknown) => caught as AppError);

			expect(error).toMatchObject({
				status: 400,
				detail: { code: "REQUEST_VALIDATION_FAILED", retryable: false },
			});
			expect(socket.emit).not.toHaveBeenCalled();
		});

		it("forwards a stale revision so the CLI can replay a completed send", async () => {
			const socket = registerSession(
				{
					messageIdempotency: true,
					messageRevisionPinning: true,
				},
				{ revision: 5 },
			);
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { stopReason: "end_turn" },
					});
				}
			});

			await expect(
				sessionRouter.sendMessage(
					{
						sessionId: "session-message",
						messageId: "completed-on-prior-revision",
						expectedRevision: 4,
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				),
			).resolves.toEqual({ stopReason: "end_turn" });
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:message:send",
				expect.objectContaining({
					params: expect.objectContaining({
						messageId: "completed-on-prior-revision",
						expectedRevision: 4,
					}),
				}),
			);
		});

		it("preserves an authoritative stale revision rejection from the CLI", async () => {
			const socket = registerSession(
				{
					messageIdempotency: true,
					messageRevisionPinning: true,
				},
				{ revision: 5 },
			);
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						error: {
							code: "SESSION_NOT_READY",
							message: "Session revision changed; refresh before sending",
							retryable: false,
							scope: "session",
							status: 409,
						},
					});
				}
			});

			await expect(
				sessionRouter.sendMessage(
					{
						sessionId: "session-message",
						messageId: "uncompleted-on-prior-revision",
						expectedRevision: 4,
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				),
			).rejects.toMatchObject({
				status: 409,
				detail: { code: "SESSION_NOT_READY", retryable: false },
			});
			expect(socket.emit).toHaveBeenCalledTimes(1);
		});

		it("forwards a pin when the cached session revision is unavailable", async () => {
			const socket = registerSession({
				messageIdempotency: true,
				messageRevisionPinning: true,
			});
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { stopReason: "end_turn" },
					});
				}
			});

			await expect(
				sessionRouter.sendMessage(
					{
						sessionId: "session-message",
						messageId: "unavailable-summary-revision",
						expectedRevision: 1,
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				),
			).resolves.toEqual({ stopReason: "end_turn" });
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:message:send",
				expect.objectContaining({
					params: expect.objectContaining({
						messageId: "unavailable-summary-revision",
						expectedRevision: 1,
					}),
				}),
			);
		});

		it("forwards a matching revision only to a capable CLI", async () => {
			const socket = registerSession(
				{
					messageIdempotency: true,
					messageRevisionPinning: true,
				},
				{ revision: 6 },
			);
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { stopReason: "end_turn" },
					});
				}
			});

			await expect(
				sessionRouter.sendMessage(
					{
						sessionId: "session-message",
						messageId: "matching-revision-pin",
						expectedRevision: 6,
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				),
			).resolves.toEqual({ stopReason: "end_turn" });
			expect(socket.emit).toHaveBeenCalledWith(
				"rpc:message:send",
				expect.objectContaining({
					params: expect.objectContaining({ expectedRevision: 6 }),
				}),
			);
		});

		it("clears a durable Gateway entry as soon as the send settles", async () => {
			const socket = registerSession({ messageIdempotency: true });
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { stopReason: "end_turn" },
					});
				}
			});
			const params = {
				sessionId: "session-message",
				messageId: "settled-message",
				prompt: { t: "encrypted" as const, c: "ciphertext" },
			};

			await sessionRouter.sendMessage(params, "user-message");
			expect(getDurableMessageSendCache().size).toBe(0);
			await sessionRouter.sendMessage(params, "user-message");

			expect(socket.emit).toHaveBeenCalledTimes(2);
		});

		it("bounds durable active sends per owner without blocking another owner", async () => {
			const firstSocket = registerSession({ messageIdempotency: true });
			const activeSends = getDurableMessageSendCache();
			for (let index = 0; index < 1_000; index++) {
				activeSends.set(`active-${index}`, {
					promise: Promise.resolve({ stopReason: "end_turn" }),
					ownerId: "user-message",
				});
			}

			const error = await sessionRouter
				.sendMessage(
					{
						sessionId: "session-message",
						messageId: "active-owner-over-quota",
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"user-message",
				)
				.catch((caught: unknown) => caught as AppError);
			expect(error).toMatchObject({
				status: 503,
				detail: {
					code: "SESSION_BUSY",
					retryable: false,
					message: expect.stringContaining("unavailable"),
				},
			});
			expect(firstSocket.emit).not.toHaveBeenCalled();

			const secondSocket = registerOwnedSession({
				userId: "other-durable-user",
				machineId: "other-durable-machine",
				sessionId: "other-durable-session",
				protocolCapabilities: { messageIdempotency: true },
			});
			secondSocket.emit.mockImplementation((event, request) => {
				if (event === "rpc:message:send") {
					sessionRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { stopReason: "end_turn" },
					});
				}
			});
			await expect(
				sessionRouter.sendMessage(
					{
						sessionId: "other-durable-session",
						messageId: "other-durable-owner",
						prompt: { t: "encrypted", c: "ciphertext" },
					},
					"other-durable-user",
				),
			).resolves.toEqual({ stopReason: "end_turn" });
			expect(secondSocket.emit).toHaveBeenCalledTimes(1);
		});

		it("allows a capable CLI to retry a failed send with its durable key", async () => {
			const socket = registerSession({ messageIdempotency: true });
			const params = {
				sessionId: "session-message",
				messageId: "durable-message",
				prompt: { t: "encrypted" as const, c: "ciphertext" },
			};

			const first = sessionRouter.sendMessage(params, "user-message");
			sessionRouter.handleCliDisconnect(socket.id);
			await expect(first).rejects.toThrow("CLI disconnected");
			void sessionRouter
				.sendMessage(params, "user-message")
				.catch(() => undefined);

			expect(socket.emit).toHaveBeenCalledTimes(2);
		});
	});

	describe("RPC error handling", () => {
		it("rejects promise when RPC returns error", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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

		it("preserves structured RPC error details and HTTP status", async () => {
			const socket = createMockSocket("socket-1");
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-1" }),
				{
					userId: "user-1",
					deviceId: "device-123",
				},
			);

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:sessions:discover") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							error: {
								code: "MESSAGE_OUTCOME_UNKNOWN",
								message: "Send it again as a new message",
								retryable: false,
								scope: "request",
								status: 409,
								detail: "The previous outcome could not be proven",
							},
						});
					}, 0);
				}
			});

			const error = await sessionRouter
				.discoverSessions("machine-1", undefined, "user-1")
				.catch((caught: unknown) => caught as AppError);

			expect(error).toMatchObject({
				status: 409,
				detail: {
					code: "MESSAGE_OUTCOME_UNKNOWN",
					message: "Send it again as a new message",
					retryable: false,
					scope: "request",
					detail: "The previous outcome could not be proven",
				},
			});
		});

		it("sanitizes generic internal RPC failures", async () => {
			const socket = createMockSocket("socket-1");
			cliRegistry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-1" }),
				{ userId: "user-1", deviceId: "device-123" },
			);

			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:sessions:discover") {
					setTimeout(() => {
						sessionRouter.handleRpcResponse({
							requestId: request.requestId,
							error: {
								code: "INTERNAL_ERROR",
								message: "ENOENT /Users/alice/private/token.txt",
								retryable: true,
								scope: "request",
								status: 500,
								detail: "secret stack trace",
							},
						});
					}, 0);
				}
			});

			const error = await sessionRouter
				.discoverSessions("machine-1", undefined, "user-1")
				.catch((caught: unknown) => caught as AppError);

			expect(error).toMatchObject({
				status: 500,
				detail: {
					code: "INTERNAL_ERROR",
					message: "Internal server error",
					retryable: true,
					scope: "request",
				},
			});
			expect((error as AppError).detail.detail).toBeUndefined();
		});

		it("rejects pending RPCs immediately when their CLI disconnects", async () => {
			const disconnectAwareRouter = sessionRouter as SessionRouter & {
				handleCliDisconnect: (socketId: string) => void;
			};
			expect(disconnectAwareRouter.handleCliDisconnect).toBeTypeOf("function");
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			cliRegistry.register(socket, info, {
				userId: "user-1",
				deviceId: "device-123",
			});
			const pending = sessionRouter.discoverSessions(
				"machine-1",
				undefined,
				"user-1",
			);

			disconnectAwareRouter.handleCliDisconnect(socket.id);

			await expect(pending).rejects.toThrow("CLI disconnected");
		});

		it("ignores RPC responses from a different authenticated CLI socket", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			cliRegistry.register(socket, info, {
				userId: "user-1",
				deviceId: "device-123",
			});
			let requestId: string | undefined;
			socket.emit.mockImplementation((event, request) => {
				if (event === "rpc:sessions:discover") requestId = request.requestId;
			});
			const pending = sessionRouter.discoverSessions(
				"machine-1",
				undefined,
				"user-1",
			);
			expect(requestId).toBeDefined();
			const sourceAwareRouter = sessionRouter as SessionRouter & {
				handleRpcResponse: (
					response: {
						requestId: string;
						result: DiscoverSessionsRpcResult;
					},
					socketId: string,
				) => void;
			};

			sourceAwareRouter.handleRpcResponse(
				{
					requestId: requestId as string,
					result: { ...createMockDiscoverResult(), sessions: [] },
				},
				"attacker-socket",
			);
			sourceAwareRouter.handleRpcResponse(
				{
					requestId: requestId as string,
					result: createMockDiscoverResult(),
				},
				socket.id,
			);

			await expect(pending).resolves.toMatchObject({
				sessions: expect.arrayContaining([
					expect.objectContaining({ sessionId: "discovered-session-1" }),
				]),
			});
		});
	});

	describe("getGitStatus", () => {
		it("routes git status request to CLI and returns result", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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

		it("throws 'Session not found' when user not authorized for session", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			cliRegistry.register(socket, info, authInfo);

			const mockSession = createMockSessionSummary({
				sessionId: "session-1",
			});
			cliRegistry.updateSessions(socket.id, [mockSession]);

			await expect(
				sessionRouter.getGitStatus("session-1", "user-2"),
			).rejects.toThrow("Session not found");
		});
	});

	describe("getGitFileDiff", () => {
		it("routes git file diff request to CLI and returns result", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
				deletedLines: [],
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
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
				deletedLines: [],
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

		it("throws 'Session not found' when user not authorized for session", async () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
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
			).rejects.toThrow("Session not found");
		});
	});
});
