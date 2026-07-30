import type {
	CliRegistrationInfo,
	SessionSummary,
	SessionsChangedPayload,
	TeamRelayPublicKey,
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
		disconnect: vi.fn(),
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

const createMockRelayKey = (seed: number): TeamRelayPublicKey => {
	const publicKey = Buffer.alloc(32, seed).toString("base64");
	return {
		version: 1,
		keyId: `x25519:${publicKey}`,
		publicKey,
	};
};

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
			expect(record.sessionSnapshotReady).toBe(false);
			expect(registry.getCliBySocketId("socket-1")).toBe(record);
		});

		it("registers CLI with auth info", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };

			const record = registry.register(socket, info, authInfo);

			expect(record.userId).toBe("user-1");
			expect(record.deviceId).toBe("device-123");
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
			expect(socket1.disconnect).toHaveBeenCalledWith(true);
		});

		it("uses an empty full snapshot as the barrier and resets readiness on replacement", () => {
			const socket1 = createMockSocket("socket-1");
			const socket2 = createMockSocket("socket-2");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const firstRecord = registry.register(socket1, info, {
				userId: "user-1",
				deviceId: "device-1",
			});
			const listener = vi.fn();
			registry.onSessionsChanged(listener);

			registry.updateSessions(socket1.id, []);

			expect(firstRecord.sessionSnapshotReady).toBe(true);
			expect(listener).toHaveBeenCalledWith(
				"machine-1",
				{
					machineId: "machine-1",
					added: [],
					updated: [],
					removed: [],
				},
				"user-1",
			);

			const replacement = registry.register(socket2, info, {
				userId: "user-1",
				deviceId: "device-2",
			});

			expect(replacement.sessionSnapshotReady).toBe(false);
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
			const authInfo = { userId: "user-1", deviceId: "device-123" };

			registry.register(socket, info, authInfo);
			expect(registry.getClisForUser("user-1")).toHaveLength(1);

			registry.unregister("socket-1");
			expect(registry.getClisForUser("user-1")).toHaveLength(0);
		});

		it("requires the current socket, registration token, and relay key before marking relay ready", () => {
			const socket = createMockSocket("socket-1");
			const relayKey = createMockRelayKey(1);
			const record = registry.register(
				socket,
				createMockRegistrationInfo({
					machineId: "machine-1",
					teamRelayKey: relayKey,
				}),
				{ userId: "user-1", deviceId: "device-1" },
			);

			expect(record.teamRelayReady).toBe(false);
			expect(record.teamRelayRegistrationId).toEqual(expect.any(String));
			expect(
				registry.markTeamRelayReady("unknown-socket", {
					registrationId: record.teamRelayRegistrationId,
					relayKeyId: relayKey.keyId,
				}),
			).toBe(false);
			expect(
				registry.markTeamRelayReady(socket.id, {
					registrationId: "stale-registration",
					relayKeyId: relayKey.keyId,
				}),
			).toBe(false);
			expect(
				registry.markTeamRelayReady(socket.id, {
					registrationId: record.teamRelayRegistrationId,
					relayKeyId: createMockRelayKey(2).keyId,
				}),
			).toBe(false);
			expect(record.teamRelayReady).toBe(false);

			expect(
				registry.markTeamRelayReady(socket.id, {
					registrationId: record.teamRelayRegistrationId,
					relayKeyId: relayKey.keyId,
				}),
			).toBe(true);
			expect(record.teamRelayReady).toBe(true);
			expect(
				registry.markTeamRelayReady(socket.id, {
					registrationId: record.teamRelayRegistrationId,
					relayKeyId: relayKey.keyId,
				}),
			).toBe(true);
		});

		it("rotates relay registration tokens and rejects stale reconnect generations", () => {
			const relayKey = createMockRelayKey(1);
			const firstSocket = createMockSocket("socket-1");
			const firstRecord = registry.register(
				firstSocket,
				createMockRegistrationInfo({
					machineId: "machine-1",
					teamRelayKey: relayKey,
				}),
				{ userId: "user-1", deviceId: "device-1" },
			);
			const firstRegistrationId = firstRecord.teamRelayRegistrationId;
			const secondSocket = createMockSocket("socket-2");
			const secondRecord = registry.register(
				secondSocket,
				createMockRegistrationInfo({
					machineId: "machine-1",
					teamRelayKey: relayKey,
				}),
				{ userId: "user-1", deviceId: "device-1" },
			);

			expect(secondRecord.teamRelayRegistrationId).not.toBe(
				firstRegistrationId,
			);
			expect(secondRecord.teamRelayReady).toBe(false);
			expect(
				registry.markTeamRelayReady(firstSocket.id, {
					registrationId: firstRegistrationId,
					relayKeyId: relayKey.keyId,
				}),
			).toBe(false);
			expect(
				registry.markTeamRelayReady(secondSocket.id, {
					registrationId: firstRegistrationId,
					relayKeyId: relayKey.keyId,
				}),
			).toBe(false);
			expect(secondRecord.teamRelayReady).toBe(false);
			expect(
				registry.markTeamRelayReady(secondSocket.id, {
					registrationId: secondRecord.teamRelayRegistrationId,
					relayKeyId: relayKey.keyId,
				}),
			).toBe(true);
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

		it("emits a user-scoped diff for full snapshots without repeating heartbeats", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info, {
				userId: "user-1",
				deviceId: "device-1",
			});
			const listener = vi.fn();
			registry.onSessionsChanged(listener);
			const session = createMockSessionSummary({
				sessionId: "session-1",
				title: "Initial",
			});

			registry.updateSessions(socket.id, [session]);

			expect(listener).toHaveBeenCalledWith(
				"machine-1",
				{
					machineId: "machine-1",
					added: [{ ...session, machineId: "machine-1" }],
					updated: [],
					removed: [],
				},
				"user-1",
			);

			listener.mockClear();
			registry.updateSessions(socket.id, [{ ...session }]);
			expect(listener).not.toHaveBeenCalled();

			registry.updateSessions(socket.id, [
				{ ...session, title: "Updated" },
				createMockSessionSummary({ sessionId: "session-2" }),
			]);
			expect(listener).toHaveBeenCalledWith(
				"machine-1",
				expect.objectContaining({
					added: [expect.objectContaining({ sessionId: "session-2" })],
					updated: [
						expect.objectContaining({
							sessionId: "session-1",
							title: "Updated",
						}),
					],
					removed: [],
				}),
				"user-1",
			);
		});

		it("preserves omitted metadata and applies an explicit null replacement", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);
			registry.updateSessions(socket.id, [
				createMockSessionSummary({
					sessionId: "session-1",
					_meta: { retained: true },
				}),
			]);

			registry.updateSessions(socket.id, [
				createMockSessionSummary({ sessionId: "session-1", title: "Updated" }),
			]);
			expect(registry.getCliBySocketId(socket.id)?.sessions[0]?._meta).toEqual({
				retained: true,
			});

			registry.updateSessions(socket.id, [
				createMockSessionSummary({ sessionId: "session-1", _meta: null }),
			]);
			expect(
				registry.getCliBySocketId(socket.id)?.sessions[0]?._meta,
			).toBeNull();
		});
	});

	describe("addDiscoveredSessionsForMachine", () => {
		it("adds new sessions and emits sessions:changed", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			registry.register(socket, info, authInfo);
			registry.updateSessions(socket.id, []);

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
						expect.objectContaining({
							sessionId: "session-1",
							machineId: "machine-1",
						}),
					]),
					machineId: "machine-1",
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
							machineId: "machine-1",
						}),
					]),
					removed: [],
					machineId: "machine-1",
				}),
				undefined,
			);
		});

		it("does not overwrite attached metadata or a detached pinned title", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);
			registry.updateSessions("socket-1", [
				createMockSessionSummary({
					sessionId: "attached-session",
					title: "Live title",
					isAttached: true,
					_meta: { live: true },
				}),
				createMockSessionSummary({
					sessionId: "pinned-session",
					title: "Pinned title",
					isAttached: false,
					isTitlePinned: true,
					_meta: { old: true },
				}),
			]);

			registry.addDiscoveredSessionsForMachine("machine-1", [
				createMockSessionSummary({
					sessionId: "attached-session",
					title: "Stale title",
					_meta: { stale: true },
				}),
				createMockSessionSummary({
					sessionId: "pinned-session",
					title: "Agent title",
					_meta: { fresh: true },
				}),
			]);

			const sessions = registry.getCliBySocketId("socket-1")?.sessions;
			expect(sessions?.[0]).toEqual(
				expect.objectContaining({
					title: "Live title",
					_meta: { live: true },
				}),
			);
			expect(sessions?.[1]).toEqual(
				expect.objectContaining({
					title: "Pinned title",
					_meta: { fresh: true },
				}),
			);
		});
	});

	describe("updateSessionsIncremental", () => {
		it("updates registry state without emitting before the first full snapshot", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const record = registry.register(socket, info, {
				userId: "user-1",
				deviceId: "device-1",
			});
			const listener = vi.fn();
			registry.onSessionsChanged(listener);

			registry.updateSessionsIncremental(socket.id, {
				added: [
					createMockSessionSummary({ sessionId: "incremental-before-ready" }),
				],
				updated: [],
				removed: [],
			});
			registry.addDiscoveredSessionsForMachine(
				record.machineId,
				[
					createMockSessionSummary({
						sessionId: "discovered-before-ready",
					}),
				],
				record.userId,
			);

			expect(record.sessionSnapshotReady).toBe(false);
			expect(record.sessions.map((session) => session.sessionId)).toEqual([
				"incremental-before-ready",
				"discovered-before-ready",
			]);
			expect(listener).not.toHaveBeenCalled();
		});

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

		it("preserves metadata when an incremental update omits it", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info);
			registry.updateSessions(socket.id, [
				createMockSessionSummary({
					sessionId: "session-1",
					_meta: { retained: true },
				}),
			]);

			const enhanced = registry.updateSessionsIncremental(socket.id, {
				added: [],
				updated: [
					createMockSessionSummary({
						sessionId: "session-1",
						title: "Updated",
					}),
				],
				removed: [],
			});

			expect(registry.getCliBySocketId(socket.id)?.sessions[0]?._meta).toEqual({
				retained: true,
			});
			expect(enhanced?.updated[0]?._meta).toEqual({ retained: true });
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
				machineId: "spoofed-top-level",
				added: [createMockSessionSummary({ sessionId: "session-1" })],
				updated: [
					createMockSessionSummary({
						sessionId: "session-2",
						machineId: "spoofed-summary",
					}),
				],
				removed: [],
			};

			const enhancedPayload = registry.updateSessionsIncremental(
				"socket-1",
				payload,
			);

			expect(enhancedPayload?.machineId).toBe("machine-1");
			expect(enhancedPayload?.added[0].machineId).toBe("machine-1");
			expect(enhancedPayload?.updated[0].machineId).toBe("machine-1");
		});

		it("canonicalizes full snapshot storage and emission to the registered machine", () => {
			const socket = createMockSocket("socket-1");
			registry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-1" }),
				{ userId: "user-1", deviceId: "device-1" },
			);
			const listener = vi.fn();
			registry.onSessionsChanged(listener);

			registry.updateSessions(socket.id, [
				createMockSessionSummary({
					sessionId: "session-1",
					machineId: "spoofed-machine",
				}),
			]);

			expect(registry.getCliBySocketId(socket.id)?.sessions[0]?.machineId).toBe(
				"machine-1",
			);
			expect(listener).toHaveBeenCalledWith(
				"machine-1",
				expect.objectContaining({
					machineId: "machine-1",
					added: [
						expect.objectContaining({
							sessionId: "session-1",
							machineId: "machine-1",
						}),
					],
				}),
				"user-1",
			);
		});

		it("emits sessions:changed event with userId", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };
			const changeListener = vi.fn();

			registry.register(socket, info, authInfo);
			registry.updateSessions(socket.id, []);
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
			const authInfo = { userId: "user-1", deviceId: "device-123" };

			const record = registry.register(socket, info, authInfo);

			expect(registry.getCliByMachineIdForUser("machine-1", "user-1")).toBe(
				record,
			);
		});

		it("returns undefined when user does not own the machine", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			const authInfo = { userId: "user-1", deviceId: "device-123" };

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
			registry.updateSessions(socket.id, []);

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

	describe("backend capabilities", () => {
		it("sanitizes every capability snapshot before caching and emitting it", () => {
			const socket = createMockSocket("socket-1");
			const record = registry.register(
				socket,
				createMockRegistrationInfo({ machineId: "machine-1" }),
				{ userId: "user-1", deviceId: "device-1" },
			);
			const statusListener = vi.fn();
			registry.onCliStatus(statusListener);

			registry.updateBackendCapabilities("socket-1", {
				"backend-1": {
					list: true,
					load: false,
					auth: {
						methods: [
							{ id: "browser", name: "Browser" },
							{ id: " browser", name: "Leading whitespace" },
							{ id: "trailing ", name: "Trailing whitespace" },
							{ id: "control\u0000", name: "Control ID" },
							{ id: "bad-name", name: "Bad\nname" },
							{
								id: "bad-description",
								name: "Bad description",
								description: "secret\u007fvalue",
							},
							{
								id: "environment",
								name: "Environment",
								type: "env_var",
								vars: [{ name: "TOKEN" }],
							} as never,
						],
						logout: true,
					} as never,
				} as never,
				"unregistered-backend": {
					list: true,
					load: true,
				} as never,
			});

			expect(record.backendCapabilities).toEqual({
				"backend-1": {
					list: true,
					load: false,
					auth: {
						methods: [{ id: "browser", name: "Browser" }],
						logout: true,
					},
				},
			});
			expect(statusListener).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: "user-1",
					backendCapabilities: record.backendCapabilities,
				}),
			);
		});
	});

	describe("getSessionsForUser", () => {
		it("routes a session only when exactly one ready current machine owns it", () => {
			const readySocket = createMockSocket("ready-socket");
			const duplicateSocket = createMockSocket("duplicate-socket");
			const unreadySocket = createMockSocket("unready-socket");
			registry.register(
				readySocket,
				createMockRegistrationInfo({ machineId: "machine-ready" }),
				{ userId: "user-1", deviceId: "device-ready" },
			);
			registry.register(
				duplicateSocket,
				createMockRegistrationInfo({ machineId: "machine-duplicate" }),
				{ userId: "user-1", deviceId: "device-duplicate" },
			);
			registry.register(
				unreadySocket,
				createMockRegistrationInfo({ machineId: "machine-unready" }),
				{ userId: "user-1", deviceId: "device-unready" },
			);
			registry.updateSessions(readySocket.id, [
				createMockSessionSummary({ sessionId: "unique-ready" }),
				createMockSessionSummary({ sessionId: "duplicate" }),
			]);
			registry.updateSessions(duplicateSocket.id, [
				createMockSessionSummary({ sessionId: "duplicate" }),
			]);
			registry.updateSessionsIncremental(unreadySocket.id, {
				added: [createMockSessionSummary({ sessionId: "unready-only" })],
				updated: [],
				removed: [],
			});

			expect(
				registry.getCliForSessionByUser("unique-ready", "user-1")?.machineId,
			).toBe("machine-ready");
			expect(
				registry.getCliForSessionByUser("duplicate", "user-1"),
			).toBeUndefined();
			expect(
				registry.getCliForSessionByUser("unready-only", "user-1"),
			).toBeUndefined();
		});

		it("quarantines cross-machine duplicate IDs from ready HTTP snapshots", () => {
			const firstSocket = createMockSocket("first-socket");
			const secondSocket = createMockSocket("second-socket");
			registry.register(
				firstSocket,
				createMockRegistrationInfo({ machineId: "machine-1" }),
				{ userId: "user-1", deviceId: "device-1" },
			);
			registry.register(
				secondSocket,
				createMockRegistrationInfo({ machineId: "machine-2" }),
				{ userId: "user-1", deviceId: "device-2" },
			);
			registry.updateSessions(firstSocket.id, [
				createMockSessionSummary({ sessionId: "unique-1" }),
				createMockSessionSummary({ sessionId: "duplicate" }),
			]);
			registry.updateSessions(secondSocket.id, [
				createMockSessionSummary({ sessionId: "unique-2" }),
				createMockSessionSummary({ sessionId: "duplicate" }),
			]);

			expect(
				registry
					.getReadySessionsForUser("user-1")
					.map((session) => session.sessionId)
					.sort(),
			).toEqual(["unique-1", "unique-2"]);
			expect(registry.getReadySessionIdCollisionsForUser("user-1")).toEqual([
				"duplicate",
			]);
		});

		it("exposes only sessions from registrations with a complete snapshot", () => {
			const readySocket = createMockSocket("ready-socket");
			const unreadySocket = createMockSocket("unready-socket");
			registry.register(
				readySocket,
				createMockRegistrationInfo({ machineId: "machine-ready" }),
				{ userId: "user-1", deviceId: "device-ready" },
			);
			registry.register(
				unreadySocket,
				createMockRegistrationInfo({ machineId: "machine-unready" }),
				{ userId: "user-1", deviceId: "device-unready" },
			);
			const readySession = createMockSessionSummary({
				sessionId: "ready-session",
			});
			const prematureSession = createMockSessionSummary({
				sessionId: "premature-session",
			});

			registry.updateSessions(readySocket.id, [readySession]);
			registry.updateSessionsIncremental(unreadySocket.id, {
				added: [prematureSession],
				updated: [],
				removed: [],
			});

			expect(registry.getReadySessionsForUser("user-1")).toEqual([
				{
					...readySession,
					machineId: "machine-ready",
				},
			]);
		});

		it("withholds a replacement until its first full snapshot arrives", () => {
			const originalSocket = createMockSocket("original-socket");
			const replacementSocket = createMockSocket("replacement-socket");
			const registration = createMockRegistrationInfo({
				machineId: "machine-1",
			});
			registry.register(originalSocket, registration, {
				userId: "user-1",
				deviceId: "device-original",
			});
			registry.updateSessions(originalSocket.id, [
				createMockSessionSummary({ sessionId: "original-session" }),
			]);

			registry.register(replacementSocket, registration, {
				userId: "user-1",
				deviceId: "device-replacement",
			});

			expect(registry.getReadySessionsForUser("user-1")).toEqual([]);

			const replacementSession = createMockSessionSummary({
				sessionId: "replacement-session",
			});
			registry.updateSessions(replacementSocket.id, [replacementSession]);

			expect(registry.getReadySessionsForUser("user-1")).toEqual([
				{
					...replacementSession,
					machineId: "machine-1",
				},
			]);
		});

		it("preserves CLI Team ownership while only adding the machine ID", () => {
			const socket = createMockSocket("socket-1");
			const info = createMockRegistrationInfo({ machineId: "machine-1" });
			registry.register(socket, info, {
				userId: "user-1",
				deviceId: "device-1",
			});
			const cliSession = createMockSessionSummary({
				sessionId: "team-worker-session",
				agentTeamOwned: true,
			});

			registry.updateSessions(socket.id, [cliSession]);

			expect(registry.getCliBySocketId(socket.id)?.sessions).toEqual([
				{ ...cliSession, machineId: "machine-1" },
			]);
			expect(registry.getSessionsForUser("user-1")).toEqual([
				{
					...cliSession,
					machineId: "machine-1",
				},
			]);
		});

		it("returns sessions only for authenticated user's machines", () => {
			const socket1 = createMockSocket("socket-1");
			const socket2 = createMockSocket("socket-2");
			const info1 = createMockRegistrationInfo({ machineId: "machine-1" });
			const info2 = createMockRegistrationInfo({ machineId: "machine-2" });

			registry.register(socket1, info1, {
				userId: "user-1",
				deviceId: "device-1",
			});
			registry.register(socket2, info2, {
				userId: "user-2",
				deviceId: "device-2",
			});

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
