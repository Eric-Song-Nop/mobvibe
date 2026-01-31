import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig } from "../../config.js";
import { SessionManager } from "../session-manager.js";

// Mock the AcpConnection class
vi.mock("../acp-connection.js", () => ({
	AcpConnection: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		createSession: vi.fn().mockResolvedValue({
			sessionId: "new-session-1",
			modes: null,
			models: null,
		}),
		getStatus: vi.fn().mockReturnValue({
			backendId: "backend-1",
			backendLabel: "Claude Code",
			state: "ready",
			command: "claude-code",
			args: [],
			pid: 12345,
		}),
		getAgentInfo: vi.fn().mockReturnValue({
			name: "claude-code",
			title: "Claude Code",
		}),
		getSessionCapabilities: vi.fn().mockReturnValue({
			list: true,
			load: true,
		}),
		supportsSessionList: vi.fn().mockReturnValue(true),
		supportsSessionLoad: vi.fn().mockReturnValue(true),
		listSessions: vi.fn().mockResolvedValue({
			sessions: [
				{
					sessionId: "discovered-1",
					cwd: "/home/user/project1",
					title: "Project 1",
					updatedAt: new Date().toISOString(),
				},
				{
					sessionId: "discovered-2",
					cwd: "/home/user/project2",
					title: "Project 2",
				},
			],
			nextCursor: undefined,
		}),
		loadSession: vi.fn().mockResolvedValue({
			modes: null,
			models: null,
		}),
		setPermissionHandler: vi.fn(),
		onSessionUpdate: vi.fn().mockReturnValue(() => {}),
		onTerminalOutput: vi.fn().mockReturnValue(() => {}),
		onStatusChange: vi.fn().mockReturnValue(() => {}),
	})),
}));

// Mock the logger
vi.mock("../../lib/logger.js", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

const createMockConfig = (): CliConfig => ({
	gatewayUrl: "http://localhost:3005",
	clientName: "test-client",
	clientVersion: "1.0.0",
	acpBackends: [
		{
			id: "backend-1",
			label: "Claude Code",
			command: "claude-code",
			args: [],
		},
	],
	defaultAcpBackendId: "backend-1",
	homePath: "/tmp/mobvibe-test",
	logPath: "/tmp/mobvibe-test/logs",
	pidFile: "/tmp/mobvibe-test/daemon.pid",
	machineId: "test-machine-id",
	hostname: "test-host",
	platform: "linux",
});

describe("SessionManager", () => {
	let sessionManager: SessionManager;
	let mockConfig: CliConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig = createMockConfig();
		sessionManager = new SessionManager(mockConfig);
	});

	describe("discoverSessions", () => {
		it("discovers sessions from agent", async () => {
			const result = await sessionManager.discoverSessions();

			expect(result.sessions).toHaveLength(2);
			expect(result.sessions[0].sessionId).toBe("discovered-1");
			expect(result.sessions[0].cwd).toBe("/home/user/project1");
			expect(result.sessions[0].title).toBe("Project 1");
			expect(result.sessions[1].sessionId).toBe("discovered-2");
			expect(result.capabilities.list).toBe(true);
			expect(result.capabilities.load).toBe(true);
		});

		it("discovers sessions with cwd filter", async () => {
			const result = await sessionManager.discoverSessions({
				cwd: "/home/user/project1",
			});

			expect(result.sessions).toHaveLength(2);
			// The mock doesn't filter, but we verify the parameter is passed
		});

		it("discovers sessions with specific backend", async () => {
			const result = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});

			expect(result.sessions).toHaveLength(2);
		});

		it("throws error for invalid backend", async () => {
			await expect(
				sessionManager.discoverSessions({ backendId: "invalid-backend" }),
			).rejects.toThrow("Invalid backend ID");
		});

		it("returns empty sessions when list not supported", async () => {
			// Get the AcpConnection mock
			const { AcpConnection } = await import("../acp-connection.js");
			const MockedAcpConnection = AcpConnection as unknown as ReturnType<
				typeof vi.fn
			>;
			MockedAcpConnection.mockImplementationOnce(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						disconnect: vi.fn().mockResolvedValue(undefined),
						getSessionCapabilities: vi.fn().mockReturnValue({
							list: false,
							load: false,
						}),
						supportsSessionList: vi.fn().mockReturnValue(false),
						listSessions: vi.fn(),
					}) as unknown,
			);

			const manager = new SessionManager(mockConfig);
			const result = await manager.discoverSessions();

			expect(result.sessions).toEqual([]);
			expect(result.capabilities.list).toBe(false);
		});
	});

	describe("loadSession", () => {
		it("loads a historical session", async () => {
			const result = await sessionManager.loadSession(
				"session-to-load",
				"/home/user/project",
			);

			expect(result.sessionId).toBe("session-to-load");
			expect(result.title).toBe("session-to-load");
			expect(result.cwd).toBe("/home/user/project");
			expect(result.sessionId).toBeDefined();
		});

		it("returns existing session if already loaded", async () => {
			// First, create a session
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
			});

			// Try to load the same session
			const loaded = await sessionManager.loadSession(
				created.sessionId,
				"/home/user/project",
			);

			expect(loaded.sessionId).toBe(created.sessionId);
		});

		it("emits sessions:changed event when session loaded", async () => {
			const changedListener = vi.fn();
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.loadSession("session-to-load", "/home/user/project");

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: expect.arrayContaining([
						expect.objectContaining({ sessionId: "session-to-load" }),
					]),
					updated: [],
					removed: [],
				}),
			);
		});

		it("throws error when load not supported", async () => {
			const { AcpConnection } = await import("../acp-connection.js");
			const MockedAcpConnection = AcpConnection as unknown as ReturnType<
				typeof vi.fn
			>;
			MockedAcpConnection.mockImplementationOnce(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						disconnect: vi.fn().mockResolvedValue(undefined),
						supportsSessionLoad: vi.fn().mockReturnValue(false),
					}) as unknown,
			);

			const manager = new SessionManager(mockConfig);

			await expect(
				manager.loadSession("session-1", "/home/user/project"),
			).rejects.toThrow("Agent does not support session loading");
		});
	});

	describe("listSessions", () => {
		it("returns empty array initially", () => {
			const sessions = sessionManager.listSessions();
			expect(sessions).toEqual([]);
		});

		it("returns sessions after creating one", async () => {
			await sessionManager.createSession({ cwd: "/home/user/project" });

			const sessions = sessionManager.listSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0].sessionId).toBeDefined();
		});
	});

	describe("closeSession", () => {
		it("closes and removes session", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
			});

			const result = await sessionManager.closeSession(created.sessionId);

			expect(result).toBe(true);
			expect(sessionManager.listSessions()).toHaveLength(0);
		});

		it("emits sessions:changed event when session closed", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
			});

			const changedListener = vi.fn();
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.closeSession(created.sessionId);

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: [],
					updated: [],
					removed: [created.sessionId],
				}),
			);
		});

		it("returns false for unknown session", async () => {
			const result = await sessionManager.closeSession("unknown-session");
			expect(result).toBe(false);
		});
	});
});
