import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WalStore } from "../wal-store.js";

describe("WalStore", () => {
	let walStore: WalStore;
	let tempDir: string;
	let dbPath: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-test-"));
		dbPath = path.join(tempDir, "events.db");
		walStore = new WalStore(dbPath);
	});

	afterEach(() => {
		walStore.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("ensureSession", () => {
		it("should create a new session", () => {
			const result = walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
				cwd: "/home/user/project",
				title: "Test Session",
			});

			expect(result.revision).toBe(1);

			const session = walStore.getSession("session-1");
			expect(session).toBeDefined();
			expect(session?.sessionId).toBe("session-1");
			expect(session?.machineId).toBe("machine-1");
			expect(session?.backendId).toBe("backend-1");
			expect(session?.cwd).toBe("/home/user/project");
			expect(session?.title).toBe("Test Session");
			expect(session?.currentRevision).toBe(1);
		});

		it("should return existing session revision", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			const result = walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
				title: "Updated Title",
			});

			expect(result.revision).toBe(1);

			const session = walStore.getSession("session-1");
			expect(session?.title).toBe("Updated Title");
		});
	});

	describe("appendEvent", () => {
		it("should append events with incrementing sequence", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			const event1 = walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: { text: "Hello" },
			});

			const event2 = walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "agent_message_chunk",
				payload: { text: "Hi there" },
			});

			expect(event1.seq).toBe(1);
			expect(event2.seq).toBe(2);
			expect(event1.kind).toBe("user_message");
			expect(event2.kind).toBe("agent_message_chunk");
		});

		it("should store payload correctly", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			const payload = {
				text: "Hello, world!",
				nested: { value: 42 },
				array: [1, 2, 3],
			};

			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload,
			});

			const events = walStore.queryEvents({
				sessionId: "session-1",
				revision: 1,
			});

			expect(events.length).toBe(1);
			expect(events[0].payload).toEqual(payload);
		});
	});

	describe("queryEvents", () => {
		beforeEach(() => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			for (let i = 1; i <= 10; i++) {
				walStore.appendEvent({
					sessionId: "session-1",
					revision: 1,
					kind: "agent_message_chunk",
					payload: { index: i },
				});
			}
		});

		it("should query all events", () => {
			const events = walStore.queryEvents({
				sessionId: "session-1",
				revision: 1,
			});

			expect(events.length).toBe(10);
			expect(events[0].seq).toBe(1);
			expect(events[9].seq).toBe(10);
		});

		it("should query events after a sequence", () => {
			const events = walStore.queryEvents({
				sessionId: "session-1",
				revision: 1,
				afterSeq: 5,
			});

			expect(events.length).toBe(5);
			expect(events[0].seq).toBe(6);
			expect(events[4].seq).toBe(10);
		});

		it("should limit results", () => {
			const events = walStore.queryEvents({
				sessionId: "session-1",
				revision: 1,
				limit: 3,
			});

			expect(events.length).toBe(3);
			expect(events[0].seq).toBe(1);
			expect(events[2].seq).toBe(3);
		});

		it("should combine afterSeq and limit", () => {
			const events = walStore.queryEvents({
				sessionId: "session-1",
				revision: 1,
				afterSeq: 3,
				limit: 4,
			});

			expect(events.length).toBe(4);
			expect(events[0].seq).toBe(4);
			expect(events[3].seq).toBe(7);
		});

		it("should return empty for non-existent session", () => {
			const events = walStore.queryEvents({
				sessionId: "non-existent",
				revision: 1,
			});

			expect(events.length).toBe(0);
		});
	});

	describe("ackEvents", () => {
		beforeEach(() => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			for (let i = 1; i <= 5; i++) {
				walStore.appendEvent({
					sessionId: "session-1",
					revision: 1,
					kind: "agent_message_chunk",
					payload: { index: i },
				});
			}
		});

		it("should acknowledge events up to sequence", () => {
			walStore.ackEvents("session-1", 1, 3);

			const unackedEvents = walStore.getUnackedEvents("session-1", 1);
			expect(unackedEvents.length).toBe(2);
			expect(unackedEvents[0].seq).toBe(4);
			expect(unackedEvents[1].seq).toBe(5);
		});

		it("should acknowledge all events", () => {
			walStore.ackEvents("session-1", 1, 5);

			const unackedEvents = walStore.getUnackedEvents("session-1", 1);
			expect(unackedEvents.length).toBe(0);
		});

		it("should not acknowledge events from different revision", () => {
			walStore.ackEvents("session-1", 2, 3);

			const unackedEvents = walStore.getUnackedEvents("session-1", 1);
			expect(unackedEvents.length).toBe(5);
		});
	});

	describe("incrementRevision", () => {
		it("should increment revision and reset sequence", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: {},
			});

			const newRevision = walStore.incrementRevision("session-1");
			expect(newRevision).toBe(2);

			const session = walStore.getSession("session-1");
			expect(session?.currentRevision).toBe(2);

			// New event should start at seq 1
			const event = walStore.appendEvent({
				sessionId: "session-1",
				revision: 2,
				kind: "user_message",
				payload: {},
			});
			expect(event.seq).toBe(1);
		});

		it("should throw for non-existent session", () => {
			expect(() => walStore.incrementRevision("non-existent")).toThrow(
				"Session not found",
			);
		});
	});

	describe("getCurrentSeq", () => {
		it("should return current sequence", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			expect(walStore.getCurrentSeq("session-1", 1)).toBe(0);

			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: {},
			});

			expect(walStore.getCurrentSeq("session-1", 1)).toBe(1);

			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "agent_message_chunk",
				payload: {},
			});

			expect(walStore.getCurrentSeq("session-1", 1)).toBe(2);
		});
	});

	describe("archiveSession", () => {
		it("should delete session events and session record, mark as archived", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: { text: "Hello" },
			});

			walStore.archiveSession("session-1");

			// Session record should be gone
			expect(walStore.getSession("session-1")).toBeNull();

			// Events should be gone
			const events = walStore.queryEvents({
				sessionId: "session-1",
				revision: 1,
			});
			expect(events.length).toBe(0);

			// Should be marked as archived
			expect(walStore.isArchived("session-1")).toBe(true);
		});

		it("should be idempotent for already-archived sessions", () => {
			walStore.archiveSession("non-existent");
			expect(walStore.isArchived("non-existent")).toBe(true);

			// Archiving again should not throw
			walStore.archiveSession("non-existent");
			expect(walStore.isArchived("non-existent")).toBe(true);
		});
	});

	describe("bulkArchiveSessions", () => {
		it("should archive multiple sessions and return count", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			walStore.ensureSession({
				sessionId: "session-2",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			const count = walStore.bulkArchiveSessions(["session-1", "session-2"]);

			expect(count).toBe(2);
			expect(walStore.isArchived("session-1")).toBe(true);
			expect(walStore.isArchived("session-2")).toBe(true);
			expect(walStore.getSession("session-1")).toBeNull();
			expect(walStore.getSession("session-2")).toBeNull();
		});
	});

	describe("getArchivedSessionIds", () => {
		it("should return all archived session IDs", () => {
			walStore.archiveSession("session-a");
			walStore.archiveSession("session-b");

			const ids = walStore.getArchivedSessionIds();
			expect(ids).toContain("session-a");
			expect(ids).toContain("session-b");
			expect(ids.length).toBe(2);
		});

		it("should return empty array when no sessions archived", () => {
			const ids = walStore.getArchivedSessionIds();
			expect(ids.length).toBe(0);
		});
	});

	describe("discovery exclusion of archived sessions", () => {
		it("should exclude archived sessions from getDiscoveredSessions", () => {
			// Save two discovered sessions
			walStore.saveDiscoveredSessions([
				{
					sessionId: "session-1",
					backendId: "backend-1",
					cwd: "/home/user/project1",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
				{
					sessionId: "session-2",
					backendId: "backend-1",
					cwd: "/home/user/project2",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			// Archive session-1
			walStore.archiveSession("session-1");

			// Only session-2 should be returned
			const discovered = walStore.getDiscoveredSessions();
			expect(discovered.length).toBe(1);
			expect(discovered[0].sessionId).toBe("session-2");
		});

		it("should exclude archived sessions from getDiscoveredSessions with backendId filter", () => {
			walStore.saveDiscoveredSessions([
				{
					sessionId: "session-1",
					backendId: "backend-1",
					cwd: "/home/user/project1",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
				{
					sessionId: "session-2",
					backendId: "backend-1",
					cwd: "/home/user/project2",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			walStore.archiveSession("session-1");

			const discovered = walStore.getDiscoveredSessions("backend-1");
			expect(discovered.length).toBe(1);
			expect(discovered[0].sessionId).toBe("session-2");
		});
	});

	describe("persistence", () => {
		it("should persist and reload data", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
				title: "Persistent Session",
			});

			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: { text: "Hello" },
			});

			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "agent_message_chunk",
				payload: { text: "Hi" },
			});

			walStore.close();

			// Reopen the store
			const newStore = new WalStore(dbPath);

			const session = newStore.getSession("session-1");
			expect(session?.title).toBe("Persistent Session");

			const events = newStore.queryEvents({
				sessionId: "session-1",
				revision: 1,
			});
			expect(events.length).toBe(2);

			// Sequence should continue correctly
			const { revision } = newStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			expect(revision).toBe(1);

			const event = newStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "turn_end",
				payload: {},
			});
			expect(event.seq).toBe(3);

			newStore.close();
		});
	});
});
