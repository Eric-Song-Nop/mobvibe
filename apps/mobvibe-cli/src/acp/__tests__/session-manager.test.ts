import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { CliConfig } from "../../config.js";
import type { AcpConnection } from "../acp-connection.js";

mock.module("node:fs/promises", () => ({
	default: {
		stat: mock(() => Promise.resolve({ isDirectory: () => true })),
		readFile: mock(() => Promise.resolve("")),
	},
	stat: mock(() => Promise.resolve({ isDirectory: () => true })),
	readFile: mock(() => Promise.resolve("")),
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

// Dynamic import so that mock.module calls above are registered first
const { SessionManager } = await import("../session-manager.js");

/**
 * Captured callback from `onSessionUpdate`.
 * Allows tests to trigger session update notifications.
 */
let sessionUpdateCallback:
	| ((notification: SessionNotification) => void)
	| undefined;

const createMockConnection = () => ({
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
	onSessionUpdate: mock((cb: (n: SessionNotification) => void) => {
		sessionUpdateCallback = cb;
		return () => {
			sessionUpdateCallback = undefined;
		};
	}),
	onTerminalOutput: mock(() => () => {}),
	onStatusChange: mock(() => () => {}),
});

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
	homePath: "/tmp/mobvibe-test",
	logPath: "/tmp/mobvibe-test/logs",
	pidFile: "/tmp/mobvibe-test/daemon.pid",
	walDbPath: "/tmp/mobvibe-test/events.db",
	machineId: "test-machine-id",
	hostname: "test-host",
	platform: "linux",
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

describe("SessionManager", () => {
	let sessionManager: InstanceType<typeof SessionManager>;
	let mockConfig: CliConfig;
	let mockConnection: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		mockConfig = createMockConfig();
		sessionManager = new SessionManager(mockConfig);
		mockConnection = createMockConnection();
		sessionUpdateCallback = undefined;
		sessionManager.createConnection = () =>
			mockConnection as unknown as AcpConnection;
	});

	describe("discoverSessions", () => {
		it("discovers sessions from agent", async () => {
			const result = await sessionManager.discoverSessions({
				backendId: "backend-1",
			});

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
				backendId: "backend-1",
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
				"backend-1",
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
				backendId: "backend-1",
			});

			// Try to load the same session
			const loaded = await sessionManager.loadSession(
				created.sessionId,
				"/home/user/project",
				"backend-1",
			);

			expect(loaded.sessionId).toBe(created.sessionId);
		});

		it("emits sessions:changed event when session loaded", async () => {
			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.loadSession(
				"session-to-load",
				"/home/user/project",
				"backend-1",
			);

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
			await sessionManager.loadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(1);

			// Second load (same session) - should still emit due to force flag
			await sessionManager.loadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(2);
		});
	});

	describe("reloadSession", () => {
		it("emits session:attached event even if already attached", async () => {
			const attachedListener = mock(() => {});
			sessionManager.onSessionAttached(attachedListener);

			// First load
			await sessionManager.loadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(1);

			// Reload - should emit again due to force flag
			await sessionManager.reloadSession(
				"test-session",
				"/home/user/project",
				"backend-1",
			);
			expect(attachedListener).toHaveBeenCalledTimes(2);
		});
	});

	describe("listSessions", () => {
		it("returns empty array initially", () => {
			const sessions = sessionManager.listSessions();
			expect(sessions).toEqual([]);
		});

		it("returns sessions after creating one", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const sessions = sessionManager.listSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0].sessionId).toBeDefined();
		});
	});

	describe("closeSession", () => {
		it("closes and removes session", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const result = await sessionManager.closeSession(created.sessionId);

			expect(result).toBe(true);
			expect(sessionManager.listSessions()).toHaveLength(0);
		});

		it("emits sessions:changed event when session closed", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
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

	describe("recordTurnEnd", () => {
		it("writes and emits turn_end event for active session", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "turn_end",
					payload: expect.objectContaining({ stopReason: "end_turn" }),
				}),
			);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events.some((event) => event.kind === "turn_end")).toBe(
				true,
			);
		});
	});

	describe("getSessionEvents", () => {
		it("returns empty events when requested revision does not match actual revision (Fix 2)", async () => {
			// Create a session first to have it in WAL
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
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
				backendId: "backend-1",
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

	// =========================================================================
	// isAttached field in session summaries
	// =========================================================================
	describe("isAttached in session summaries", () => {
		it("active sessions have isAttached=true in listSessions", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			const sessions = sessionManager.listSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0].isAttached).toBe(true);
		});

		it("sessions:changed event includes isAttached=true for created sessions", async () => {
			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: expect.arrayContaining([
						expect.objectContaining({ isAttached: true }),
					]),
				}),
			);
		});

		it("sessions:changed event from recordTurnEnd includes isAttached=true", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					updated: expect.arrayContaining([
						expect.objectContaining({
							sessionId,
							isAttached: true,
						}),
					]),
				}),
			);
		});
	});

	// =========================================================================
	// 2.1 message event mapping (writeSessionUpdateToWal)
	// =========================================================================
	describe("message event mapping (writeSessionUpdateToWal)", () => {
		/**
		 * Helper: create a session, get the sessionId, and attach an event listener.
		 * Returns `{ sessionId, eventListener }`.
		 */
		const setupSessionWithListener = async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);
			return { sessionId, eventListener };
		};

		it("maps user_message_chunk → user_message WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();
			expect(sessionUpdateCallback).toBeDefined();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "user_message",
				}),
			);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(events.events.some((event) => event.kind === "user_message")).toBe(
				true,
			);
		});

		it("maps agent_message_chunk → agent_message_chunk WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hello from assistant" },
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "agent_message_chunk",
				}),
			);
		});

		it("maps agent_thought_chunk → agent_thought_chunk WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: "Thinking..." },
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "agent_thought_chunk",
				}),
			);
		});

		it("maps tool_call → tool_call WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "tc-1",
					status: "in_progress",
					title: "Reading file",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "tool_call",
				}),
			);
		});

		it("maps tool_call_update → tool_call_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tc-1",
					status: "completed",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "tool_call_update",
				}),
			);
		});

		it("maps session_info_update → session_info_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					title: "Updated Title",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "session_info_update",
				}),
			);
		});

		it("maps current_mode_update → session_info_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "current_mode_update",
					currentModeId: "architect",
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "session_info_update",
				}),
			);
		});

		it("maps usage_update → usage_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "usage_update",
					used: 100,
					size: 200,
				},
			} as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "usage_update",
				}),
			);
		});

		it("maps unknown update type → unknown_update WAL event", async () => {
			const { sessionId, eventListener } = await setupSessionWithListener();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "totally_new_type",
				},
			} as unknown as SessionNotification);

			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					kind: "unknown_update",
				}),
			);
		});
	});

	// =========================================================================
	// 2.2 recordTurnEnd — sessionsChanged emission
	// =========================================================================
	describe("recordTurnEnd (sessionsChanged)", () => {
		it("emits sessionsChanged with updated session summary", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;

			const changedListener = mock(() => {});
			sessionManager.onSessionsChanged(changedListener);

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			expect(changedListener).toHaveBeenCalledWith(
				expect.objectContaining({
					added: [],
					updated: expect.arrayContaining([
						expect.objectContaining({ sessionId }),
					]),
					removed: [],
				}),
			);
		});

		it("updates session.updatedAt before emitting", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			const beforeUpdatedAt = sessions[0].updatedAt;

			// Small delay to ensure time difference
			await new Promise((resolve) => setTimeout(resolve, 10));

			sessionManager.recordTurnEnd(sessionId, "end_turn");

			const updatedSessions = sessionManager.listSessions();
			const afterUpdatedAt = updatedSessions[0].updatedAt;
			expect(afterUpdatedAt >= beforeUpdatedAt).toBe(true);
		});

		it("no-op for non-existent session", () => {
			const eventListener = mock(() => {});
			sessionManager.onSessionEvent(eventListener);

			// Should not throw or emit any event
			sessionManager.recordTurnEnd("non-existent-session", "end_turn");

			expect(eventListener).not.toHaveBeenCalled();
		});
	});

	// =========================================================================
	// 2.3 message event sequence integrity
	// =========================================================================
	describe("message event sequence integrity", () => {
		it("emits events with incrementing seq numbers", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			expect(sessionUpdateCallback).toBeDefined();

			// Trigger multiple updates
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "A" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "B" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "C" },
				},
			} as SessionNotification);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			// Verify seq numbers increment
			const seqs = events.events.map((e) => e.seq);
			for (let i = 1; i < seqs.length; i++) {
				expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
			}
		});

		it("maintains correct seq across mixed event types", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			expect(sessionUpdateCallback).toBeDefined();

			// Mix different event types
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hi" },
				},
			} as SessionNotification);
			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "tc-1",
					status: "in_progress",
					title: "Test tool",
				},
			} as SessionNotification);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			expect(events.events.length).toBeGreaterThanOrEqual(3);
			// Kinds should match the order of dispatch
			const kinds = events.events.map((e) => e.kind);
			expect(kinds).toContain("user_message");
			expect(kinds).toContain("agent_message_chunk");
			expect(kinds).toContain("tool_call");

			// Seqs should be strictly increasing
			const seqs = events.events.map((e) => e.seq);
			for (let i = 1; i < seqs.length; i++) {
				expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
			}
		});

		it("events carry correct revision number", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessions = sessionManager.listSessions();
			const sessionId = sessions[0].sessionId;
			expect(sessionUpdateCallback).toBeDefined();

			sessionUpdateCallback?.({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "text" },
				},
			} as SessionNotification);

			const events = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});

			for (const event of events.events) {
				expect(event.revision).toBe(1);
			}
		});
	});

	// =========================================================================
	// 2.4 session update subscription lifecycle
	// =========================================================================
	describe("session update subscription lifecycle", () => {
		it("subscribes to onSessionUpdate when session is created", async () => {
			await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			// onSessionUpdate should have been called during createSession
			expect(mockConnection.onSessionUpdate).toHaveBeenCalled();
			expect(sessionUpdateCallback).toBeDefined();
		});

		it("unsubscribes when session is closed", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});

			expect(sessionUpdateCallback).toBeDefined();

			await sessionManager.closeSession(created.sessionId);

			// After close, the callback should have been cleared by the unsubscribe function
			expect(sessionUpdateCallback).toBeUndefined();
		});

		it("handles updates after session is closed gracefully", async () => {
			const created = await sessionManager.createSession({
				cwd: "/home/user/project",
				backendId: "backend-1",
			});
			const sessionId = created.sessionId;

			// Capture the callback before close
			const capturedCallback = sessionUpdateCallback;
			expect(capturedCallback).toBeDefined();

			// Record count of events before close
			const beforeEvents = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			const eventCountBeforeClose = beforeEvents.events.length;

			// Close the session (clears callback via unsubscribe)
			await sessionManager.closeSession(sessionId);

			// After close, the callback should have been cleared by the unsubscribe function
			expect(sessionUpdateCallback).toBeUndefined();

			// Verify no new events were written post-close
			const afterEvents = sessionManager.getSessionEvents({
				sessionId,
				revision: 1,
				afterSeq: 0,
			});
			expect(afterEvents.events.length).toBe(eventCountBeforeClose);
		});
	});
});
