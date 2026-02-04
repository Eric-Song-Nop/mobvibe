import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { CliConfig } from "../../config.js";

mock.module("node:fs/promises", () => ({
	default: {
		stat: mock(() => Promise.resolve({ isDirectory: () => true })),
	},
}));

// Mock the AcpConnection class
mock.module("../acp-connection.js", () => ({
	AcpConnection: mock(() => ({
		connect: mock(() => Promise.resolve(undefined)),
		disconnect: mock(() => Promise.resolve(undefined)),
		createSession: mock(() =>
			Promise.resolve({
				sessionId: "new-session-1",
				modes: null,
				models: null,
			}),
		),
		getStatus: mock(() => ({
			backendId: "backend-1",
			backendLabel: "Claude Code",
			state: "ready",
			command: "claude-code",
			args: [],
			pid: 12345,
		})),
		getAgentInfo: mock(() => ({
			name: "claude-code",
			title: "Claude Code",
		})),
		getSessionCapabilities: mock(() => ({
			list: true,
			load: true,
		})),
		supportsSessionList: mock(() => true),
		supportsSessionLoad: mock(() => true),
		listSessions: mock(() =>
			Promise.resolve({
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
		),
		loadSession: mock(() =>
			Promise.resolve({
				modes: null,
				models: null,
			}),
		),
		setPermissionHandler: mock(() => {}),
		onSessionUpdate: mock(() => () => {}),
		onTerminalOutput: mock(() => () => {}),
		onStatusChange: mock(() => () => {}),
	})),
}));

// Mock the logger
mock.module("../../lib/logger.js", () => ({
	logger: {
		info: mock(() => {}),
		debug: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
	},
}));

import { SessionManager } from "../session-manager.js";

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
	walDbPath: "/tmp/mobvibe-test/events.db",
	machineId: "test-machine-id",
	hostname: "test-host",
	platform: "linux",
});

describe("SessionManager", () => {
	let sessionManager: SessionManager;
	let mockConfig: CliConfig;

	beforeEach(() => {
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
			const changedListener = mock(() => {});
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

		it("emits session:attached event when loading already-loaded session", async () => {
			const attachedListener = mock(() => {});
			sessionManager.onSessionAttached(attachedListener);

			// First load
			await sessionManager.loadSession("test-session", "/home/user/project");
			expect(attachedListener).toHaveBeenCalledTimes(1);

			// Second load (same session) - should still emit due to force flag
			await sessionManager.loadSession("test-session", "/home/user/project");
			expect(attachedListener).toHaveBeenCalledTimes(2);
		});
	});

	describe("reloadSession", () => {
		it("emits session:attached event even if already attached", async () => {
			const attachedListener = mock(() => {});
			sessionManager.onSessionAttached(attachedListener);

			// First load
			await sessionManager.loadSession("test-session", "/home/user/project");
			expect(attachedListener).toHaveBeenCalledTimes(1);

			// Reload - should emit again due to force flag
			await sessionManager.reloadSession("test-session", "/home/user/project");
			expect(attachedListener).toHaveBeenCalledTimes(2);
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

			const changedListener = mock(() => {});
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

	describe("getSessionEvents", () => {
		it("returns empty events when requested revision does not match actual revision (Fix 2)", async () => {
			// Create a session first to have it in WAL
			await sessionManager.createSession({
				cwd: "/home/user/project",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			// Query with a different revision than what the session has
			const result = sessionManager.getSessionEvents({
				sessionId,
				revision: 999, // Wrong revision
				afterSeq: 0,
			});

			// Should return empty events but with actual revision
			expect(result.events).toHaveLength(0);
			expect(result.revision).toBe(1); // Actual revision is 1
			expect(result.hasMore).toBe(false);
		});

		it("returns events when requested revision matches actual revision", async () => {
			// Create a session
			await sessionManager.createSession({
				cwd: "/home/user/project",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			// Query with correct revision
			const result = sessionManager.getSessionEvents({
				sessionId,
				revision: 1, // Correct revision
				afterSeq: 0,
			});

			// Should return events (may be empty if no events written yet, but no error)
			expect(result.revision).toBe(1);
			expect(Array.isArray(result.events)).toBe(true);
		});

		it("returns empty for non-existent session", () => {
			const result = sessionManager.getSessionEvents({
				sessionId: "non-existent-session",
				revision: 1,
				afterSeq: 0,
			});

			expect(result.events).toHaveLength(0);
			expect(result.hasMore).toBe(false);
		});
	});
});
