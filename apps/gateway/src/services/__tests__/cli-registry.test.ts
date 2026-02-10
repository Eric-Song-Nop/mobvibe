import type {
	CliRegistrationInfo,
	SessionSummary,
	SessionsChangedPayload,
} from "@mobvibe/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliRegistry } from "../cli-registry.js";

const createMockSocket = (
	id = `socket-${Math.random().toString(36).slice(2, 8)}`,
) =>
	({
		id,
		emit: vi.fn(),
		on: vi.fn(),
		join: vi.fn(),
		leave: vi.fn(),
	}) as unknown as import("socket.io").Socket;

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

describe("CliRegistry", () => {
	let registry: CliRegistry;

	beforeEach(() => {
		registry = new CliRegistry();
	});

	describe("register/unregister", () => {
		it("registers CLI connection", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });

			const record = registry.register(socket, info);

			expect(record.machineId).toBe("machine-1");
			expect(record.hostname).toBe("test-host");
			expect(record.socket).toBe(socket);
			expect(record.sessions).toEqual([]);
			expect(registry.getCliBySocketId("socket-1")).toBe(record);
		});

		it("registers CLI with auth info", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };

			const record = registry.register(socket, info, authInfo);

			expect(record.userId).toBe("user-1");
			expect(record.apiKey).toBe("key-123");
			expect(registry.getClisForUser("user-1")).toContain(record);
		});

		it("replaces existing connection for same machine", () => {
			const socket1 = createMockSocket("socket-1");
			const socket2 = createMockSocket("socket-2");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });

			registry.register(socket1, info);
			const newRecord = registry.register(socket2, info);

			expect(registry.getCliBySocketId("socket-1")).toBeUndefined();
			expect(registry.getCliBySocketId("socket-2")).toBe(newRecord);
		});

		it("unregisters and emits status event", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const statusListener = vi.fn();

			registry.onCliStatus(statusListener);
			registry.register(socket, info);
			statusListener.mockClear(); // Clear the registration status event

			const record = registry.unregister("socket-1");

			expect(record?.machineId).toBe("machine-1");
			expect(registry.getCliBySocketId("socket-1")).toBeUndefined();
			expect(statusListener).toHaveBeenCalledWith(
				expect.objectContaining({
					machineId: "machine-1",
					connected: false,
				}),
			);
		});

		it("returns undefined when unregistering unknown socket", () => {
			const record = registry.unregister("unknown-socket");
			expect(record).toBeUndefined();
		});

		it("removes from user index on unregister", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };

			registry.register(socket, info, authInfo);
			expect(registry.getClisForUser("user-1")).toHaveLength(1);

			registry.unregister("socket-1");
			expect(registry.getClisForUser("user-1")).toHaveLength(0);
		});
	});

	describe("updateSessions", () => {
		it("replaces the entire session list", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			registry.updateSessions("socket-1", [
				createMockSessionSummary({
					sessionId: "session-1",
					title: "Original Title",
				}),
				createMockSessionSummary({
					sessionId: "session-2",
					title: "Session 2",
				}),
			]);

			// Second update sends only session-1 with a new title
			registry.updateSessions("socket-1", [
				createMockSessionSummary({
					sessionId: "session-1",
					title: "Updated Title",
				}),
			]);

			const record = registry.getCliBySocketId("socket-1");
			// session-2 is gone because CLI now sends the complete list
			expect(record?.sessions).toHaveLength(1);
			expect(record?.sessions[0].sessionId).toBe("session-1");
			expect(record?.sessions[0].title).toBe("Updated Title");
		});
	});

	describe("addDiscoveredSessionsForMachine", () => {
		it("adds new sessions and emits sessions:changed", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			registry.register(socket, info, authInfo);

			const listener = vi.fn();
			registry.onSessionsChanged(listener);

			registry.addDiscoveredSessionsForMachine(
				"machine-1",
				[
					createMockSessionSummary({
						sessionId: "session-1",
						title: "Discovered 1",
					}),
				],
				"user-1",
			);

			const record = registry.getCliByMachineIdForUser("machine-1", "user-1");
			expect(record?.sessions).toHaveLength(1);
			expect(record?.sessions[0].sessionId).toBe("session-1");
			expect(listener).toHaveBeenCalledWith(
				"machine-1",
				expect.objectContaining({
					added: expect.arrayContaining([
						expect.objectContaining({ sessionId: "session-1" }),
					]),
				}),
				"user-1",
			);
		});

		it("does not emit when discovered sessions already exist", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);
			const existingSession = createMockSessionSummary({
				sessionId: "session-1",
			});

			registry.updateSessions("socket-1", [existingSession]);

			const listener = vi.fn();
			registry.onSessionsChanged(listener);

			registry.addDiscoveredSessionsForMachine("machine-1", [existingSession]);

			expect(listener).not.toHaveBeenCalled();
		});

		it("updates existing sessions when discovered metadata changes", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			registry.updateSessions("socket-1", [
				createMockSessionSummary({
					sessionId: "session-1",
					backendId: "opencode",
					backendLabel: "OpenCode",
				}),
			]);

			const listener = vi.fn();
			registry.onSessionsChanged(listener);

			registry.addDiscoveredSessionsForMachine("machine-1", [
				createMockSessionSummary({
					sessionId: "session-1",
					backendId: "codex-acp",
					backendLabel: "Codex ACP",
				}),
			]);

			const record = registry.getCliBySocketId("socket-1");
			expect(record?.sessions[0].backendId).toBe("codex-acp");
			expect(record?.sessions[0].backendLabel).toBe("Codex ACP");
			expect(listener).toHaveBeenCalledWith(
				"machine-1",
				expect.objectContaining({
					added: [],
					updated: expect.arrayContaining([
						expect.objectContaining({
							sessionId: "session-1",
							backendId: "codex-acp",
						}),
					]),
					removed: [],
				}),
				undefined,
			);
		});
	});

	describe("updateSessionsIncremental", () => {
		it("removes sessions from record.sessions", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			// Add initial sessions via updateSessions
			registry.updateSessions("socket-1", [
				createMockSessionSummary({ sessionId: "session-1" }),
				createMockSessionSummary({ sessionId: "session-2" }),
			]);

			const payload: SessionsChangedPayload = {
				added: [],
				updated: [],
				removed: ["session-1"],
			};

			registry.updateSessionsIncremental("socket-1", payload);

			const record = registry.getCliBySocketId("socket-1");
			expect(record?.sessions).toHaveLength(1);
			expect(record?.sessions[0].sessionId).toBe("session-2");
		});

		it("updates sessions in record.sessions", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			registry.updateSessions("socket-1", [
				createMockSessionSummary({
					sessionId: "session-1",
					title: "Original Title",
				}),
			]);

			const payload: SessionsChangedPayload = {
				added: [],
				updated: [
					createMockSessionSummary({
						sessionId: "session-1",
						title: "Updated Title",
						modelId: "claude-3",
					}),
				],
				removed: [],
			};

			registry.updateSessionsIncremental("socket-1", payload);

			const record = registry.getCliBySocketId("socket-1");
			expect(record?.sessions[0].title).toBe("Updated Title");
			expect(record?.sessions[0].modelId).toBe("claude-3");
		});

		it("adds new sessions to record.sessions", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			const payload: SessionsChangedPayload = {
				added: [
					createMockSessionSummary({
						sessionId: "new-session",
						title: "New Session",
					}),
				],
				updated: [],
				removed: [],
			};

			registry.updateSessionsIncremental("socket-1", payload);

			const record = registry.getCliBySocketId("socket-1");
			expect(record?.sessions).toHaveLength(1);
			expect(record?.sessions[0].sessionId).toBe("new-session");
			expect(record?.sessions[0].title).toBe("New Session");
		});

		it("does not add duplicate sessions", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			registry.updateSessions("socket-1", [
				createMockSessionSummary({ sessionId: "session-1" }),
			]);

			const payload: SessionsChangedPayload = {
				added: [createMockSessionSummary({ sessionId: "session-1" })],
				updated: [],
				removed: [],
			};

			registry.updateSessionsIncremental("socket-1", payload);

			const record = registry.getCliBySocketId("socket-1");
			expect(record?.sessions).toHaveLength(1);
		});

		it("adds machineId to enhanced payload", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			const payload: SessionsChangedPayload = {
				added: [createMockSessionSummary({ sessionId: "session-1" })],
				updated: [createMockSessionSummary({ sessionId: "session-2" })],
				removed: [],
			};

			const enhancedPayload = registry.updateSessionsIncremental(
				"socket-1",
				payload,
			);

			expect(enhancedPayload?.added[0].machineId).toBe("machine-1");
			expect(enhancedPayload?.updated[0].machineId).toBe("machine-1");
		});

		it("emits sessions:changed event with userId", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };
			const changeListener = vi.fn();

			registry.register(socket, info, authInfo);
			registry.onSessionsChanged(changeListener);

			const payload: SessionsChangedPayload = {
				added: [createMockSessionSummary({ sessionId: "session-1" })],
				updated: [],
				removed: [],
			};

			registry.updateSessionsIncremental("socket-1", payload);

			expect(changeListener).toHaveBeenCalledWith(
				"machine-1",
				expect.objectContaining({
					added: expect.arrayContaining([
						expect.objectContaining({
							sessionId: "session-1",
							machineId: "machine-1",
						}),
					]),
				}),
				"user-1",
			);
		});

		it("returns undefined for unknown socket", () => {
			const payload: SessionsChangedPayload = {
				added: [],
				updated: [],
				removed: [],
			};

			const result = registry.updateSessionsIncremental(
				"unknown-socket",
				payload,
			);

			expect(result).toBeUndefined();
		});

		it("handles mixed add + update + remove operations", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			// Setup: add initial sessions
			registry.updateSessions("socket-1", [
				createMockSessionSummary({
					sessionId: "session-1",
					title: "Session 1",
				}),
				createMockSessionSummary({
					sessionId: "session-2",
					title: "Session 2",
				}),
			]);

			const payload: SessionsChangedPayload = {
				added: [
					createMockSessionSummary({
						sessionId: "session-3",
						title: "New Session 3",
					}),
				],
				updated: [
					createMockSessionSummary({
						sessionId: "session-1",
						title: "Updated Session 1",
					}),
				],
				removed: ["session-2"],
			};

			registry.updateSessionsIncremental("socket-1", payload);

			const record = registry.getCliBySocketId("socket-1");
			expect(record?.sessions).toHaveLength(2);

			const sessionIds = record?.sessions.map((s) => s.sessionId);
			expect(sessionIds).toContain("session-1");
			expect(sessionIds).toContain("session-3");
			expect(sessionIds).not.toContain("session-2");

			const session1 = record?.sessions.find(
				(s) => s.sessionId === "session-1",
			);
			expect(session1?.title).toBe("Updated Session 1");
		});
	});

	describe("getCliByMachineIdForUser", () => {
		it("returns CLI record when user owns the machine", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };

			const record = registry.register(socket, info, authInfo);

			expect(registry.getCliByMachineIdForUser("machine-1", "user-1")).toBe(
				record,
			);
		});

		it("returns undefined when user does not own the machine", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", apiKey: "key-123" };

			registry.register(socket, info, authInfo);

			expect(
				registry.getCliByMachineIdForUser("machine-1", "user-2"),
			).toBeUndefined();
		});

		it("returns undefined when machine does not exist", () => {
			expect(
				registry.getCliByMachineIdForUser("unknown-machine", "user-1"),
			).toBeUndefined();
		});
	});

	describe("onSessionsChanged listener", () => {
		it("can subscribe and unsubscribe from sessions:changed events", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);

			const listener = vi.fn();
			const unsubscribe = registry.onSessionsChanged(listener);

			// First event
			registry.updateSessionsIncremental("socket-1", {
				added: [createMockSessionSummary({ sessionId: "session-1" })],
				updated: [],
				removed: [],
			});
			expect(listener).toHaveBeenCalledTimes(1);

			// Unsubscribe
			unsubscribe();

			// Second event should not trigger listener
			registry.updateSessionsIncremental("socket-1", {
				added: [createMockSessionSummary({ sessionId: "session-2" })],
				updated: [],
				removed: [],
			});
			expect(listener).toHaveBeenCalledTimes(1);
		});
	});

	describe("getSessionsForUser", () => {
		it("returns sessions only for authenticated user's machines", () => {
			const socket1 = createMockSocket("socket-1");
			const socket2 = createMockSocket("socket-2");
			const info1 = createMockRegistrationInfo({ machineId: "machine-1" });
			const info2 = createMockRegistrationInfo({ machineId: "machine-2" });

			registry.register(socket1, info1, { userId: "user-1", apiKey: "key-1" });
			registry.register(socket2, info2, { userId: "user-2", apiKey: "key-2" });

			registry.updateSessions("socket-1", [
				createMockSessionSummary({ sessionId: "session-1" }),
				createMockSessionSummary({ sessionId: "session-2" }),
			]);
			registry.updateSessions("socket-2", [
				createMockSessionSummary({ sessionId: "session-3" }),
			]);

			const user1Sessions = registry.getSessionsForUser("user-1");
			expect(user1Sessions).toHaveLength(2);
			expect(user1Sessions.every((s) => s.machineId === "machine-1")).toBe(
				true,
			);

			const user2Sessions = registry.getSessionsForUser("user-2");
			expect(user2Sessions).toHaveLength(1);
			expect(user2Sessions[0].sessionId).toBe("session-3");
		});
	});
});
