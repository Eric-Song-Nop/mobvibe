import { Database } from "bun:sqlite";
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

	describe("encryption identity", () => {
		it("persists one identity and rejects a different account key", () => {
			walStore.bindEncryptionIdentity("key-identity-a");
			walStore.bindEncryptionIdentity("key-identity-a");

			walStore.close();
			walStore = new WalStore(dbPath);
			expect(() => walStore.bindEncryptionIdentity("key-identity-b")).toThrow(
				"WAL encryption identity mismatch",
			);
		});

		it("does not treat an empty migrated schema as durable user data", () => {
			expect(walStore.hasDurableData()).toBeFalse();
		});

		it("detects persisted sessions and events as durable user data", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: { text: "hello" },
			});

			expect(walStore.hasDurableData()).toBeTrue();
		});

		it("detects discovered sessions as durable user data", () => {
			walStore.saveDiscoveredSessions([
				{
					sessionId: "discovered-1",
					backendId: "backend-1",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			expect(walStore.hasDurableData()).toBeTrue();
		});

		it("detects agent-team data in the shared WAL database", () => {
			const db = new Database(dbPath);
			const now = new Date().toISOString();
			db.query(`
				INSERT INTO agent_teams (
					agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
					leader_member_id, workspace_mode, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				"team-1",
				"machine-1",
				"/tmp/project",
				"Team",
				"active",
				"leader-1",
				"shared",
				now,
				now,
			);
			db.close();

			expect(walStore.hasDurableData()).toBeTrue();
		});

		it("detects a compaction record left after session cleanup", () => {
			const db = new Database(dbPath);
			db.query(`
				INSERT INTO compaction_log (
					session_id, revision, operation, events_affected, started_at
				) VALUES (?, ?, ?, ?, ?)
			`).run(
				"deleted-session",
				1,
				"delete_acked",
				10,
				new Date().toISOString(),
			);
			db.close();

			expect(walStore.hasDurableData()).toBeTrue();
		});
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

		it("does not leave a sequence gap when an append fails", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			const circular: { self?: unknown } = {};
			circular.self = circular;

			expect(() =>
				walStore.appendEvent({
					sessionId: "session-1",
					revision: 1,
					kind: "user_message",
					payload: circular,
				}),
			).toThrow();

			const event = walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: { text: "valid" },
			});
			expect(event.seq).toBe(1);
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

		it("reads unacknowledged events in stable sequence pages", () => {
			const firstPage = walStore.getUnackedEventsPage("session-1", 1, 0, 2);
			const secondPage = walStore.getUnackedEventsPage(
				"session-1",
				1,
				firstPage.at(-1)?.seq ?? 0,
				2,
			);
			const thirdPage = walStore.getUnackedEventsPage(
				"session-1",
				1,
				secondPage.at(-1)?.seq ?? 0,
				2,
			);

			expect(firstPage.map((event) => event.seq)).toEqual([1, 2]);
			expect(secondPage.map((event) => event.seq)).toEqual([3, 4]);
			expect(thirdPage.map((event) => event.seq)).toEqual([5]);
		});
	});

	describe("message send idempotency", () => {
		it("persists an indeterminate execution claim across store restarts", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			const claim = walStore.claimMessageSend("session-1", "message-1");
			expect(claim).toEqual({
				status: "claimed",
				claimId: expect.any(String),
			});

			walStore.close();
			walStore = new WalStore(dbPath);

			expect(walStore.claimMessageSend("session-1", "message-1")).toEqual({
				status: "in_progress",
			});
		});

		it("atomically replaces an execution claim with its completed result", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			const first = walStore.claimMessageSend("session-1", "message-1");
			if (first.status !== "claimed") {
				throw new Error("expected the first caller to own the claim");
			}

			walStore.completeMessageSend(
				"session-1",
				"message-1",
				first.claimId,
				"end_turn",
			);

			expect(walStore.claimMessageSend("session-1", "message-1")).toEqual({
				status: "completed",
				result: { stopReason: "end_turn" },
			});
			expect(
				walStore
					.queryEvents({ sessionId: "session-1", revision: 1 })
					.map((event) => ({ kind: event.kind, payload: event.payload })),
			).toEqual([{ kind: "turn_end", payload: { stopReason: "end_turn" } }]);
		});

		it("rolls back the result and claim deletion when turn_end cannot persist", () => {
			walStore.ensureSession({
				sessionId: "session-atomic-failure",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			const claim = walStore.claimMessageSend(
				"session-atomic-failure",
				"message-1",
			);
			if (claim.status !== "claimed") {
				throw new Error("expected an active claim");
			}
			const faultDb = new Database(dbPath);
			faultDb.exec(`
				CREATE TRIGGER fail_terminal_event
				BEFORE INSERT ON session_events
				WHEN NEW.session_id = 'session-atomic-failure' AND NEW.kind = 'turn_end'
				BEGIN
					SELECT RAISE(ABORT, 'injected terminal event failure');
				END;
			`);
			faultDb.close();

			expect(() =>
				walStore.completeMessageSend(
					"session-atomic-failure",
					"message-1",
					claim.claimId,
					"end_turn",
				),
			).toThrow("injected terminal event failure");

			expect(
				walStore.getMessageSendResult("session-atomic-failure", "message-1"),
			).toBeUndefined();
			expect(
				walStore.claimMessageSend("session-atomic-failure", "message-1"),
			).toEqual({ status: "in_progress" });
			expect(
				walStore.queryEvents({
					sessionId: "session-atomic-failure",
					revision: 1,
				}),
			).toHaveLength(0);
		});

		it("persists the first completed result across store restarts", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			walStore.recordMessageSendResult("session-1", "message-1", "end_turn");
			walStore.recordMessageSendResult("session-1", "message-1", "cancelled");
			expect(walStore.getMessageSendResult("session-1", "message-1")).toEqual({
				stopReason: "end_turn",
			});

			walStore.close();
			walStore = new WalStore(dbPath);

			expect(walStore.getMessageSendResult("session-1", "message-1")).toEqual({
				stopReason: "end_turn",
			});
		});
	});

	describe("revision encryption keys", () => {
		it("persists the first sealed key for a revision across restarts", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});

			walStore.recordSessionRevisionKey("session-1", 1, "wrapped-first");
			walStore.recordSessionRevisionKey("session-1", 1, "wrapped-replacement");
			expect(walStore.getSessionRevisionKey("session-1", 1)).toBe(
				"wrapped-first",
			);

			walStore.close();
			walStore = new WalStore(dbPath);

			expect(walStore.getSessionRevisionKey("session-1", 1)).toBe(
				"wrapped-first",
			);
		});

		it("pages every persisted revision key in stable composite-key order", () => {
			for (const sessionId of ["session-b", "session-a"]) {
				walStore.ensureSession({
					sessionId,
					machineId: "machine-1",
					backendId: "backend-1",
				});
				for (const revision of [1, 2]) {
					walStore.recordSessionRevisionKey(
						sessionId,
						revision,
						`${sessionId}-wrapped-${revision}`,
					);
				}
			}

			const firstPage = walStore.getSessionRevisionKeysPage(undefined, 3);
			const last = firstPage.at(-1);
			const secondPage = walStore.getSessionRevisionKeysPage(
				last && { sessionId: last.sessionId, revision: last.revision },
				3,
			);

			expect([...firstPage, ...secondPage]).toEqual([
				{
					sessionId: "session-a",
					revision: 1,
					wrappedDek: "session-a-wrapped-1",
				},
				{
					sessionId: "session-a",
					revision: 2,
					wrappedDek: "session-a-wrapped-2",
				},
				{
					sessionId: "session-b",
					revision: 1,
					wrappedDek: "session-b-wrapped-1",
				},
				{
					sessionId: "session-b",
					revision: 2,
					wrappedDek: "session-b-wrapped-2",
				},
			]);
		});

		it("lists only current revisions with unacknowledged events", () => {
			walStore.ensureSession({
				sessionId: "session-1",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			walStore.appendEvent({
				sessionId: "session-1",
				revision: 1,
				kind: "user_message",
				payload: { text: "obsolete" },
			});
			expect(walStore.listUnackedSessionRevisions()).toEqual([
				{ sessionId: "session-1", revision: 1 },
			]);

			walStore.incrementRevision("session-1");
			expect(walStore.listUnackedSessionRevisions()).toEqual([]);
			const current = walStore.appendEvent({
				sessionId: "session-1",
				revision: 2,
				kind: "user_message",
				payload: { text: "current" },
			});
			expect(walStore.listUnackedSessionRevisions()).toEqual([
				{ sessionId: "session-1", revision: 2 },
			]);

			walStore.ackEvents("session-1", 2, current.seq);
			expect(walStore.listUnackedSessionRevisions()).toEqual([]);
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

		it("rolls back the revision and replay batch when one event cannot be inserted", () => {
			walStore.ensureSession({
				sessionId: "session-atomic-reload",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			const faultDb = new Database(dbPath);
			faultDb.exec(`
				CREATE TRIGGER fail_second_reload_event
				BEFORE INSERT ON session_events
				WHEN NEW.session_id = 'session-atomic-reload' AND NEW.seq = 2
				BEGIN
					SELECT RAISE(ABORT, 'injected replay failure');
				END;
			`);
			faultDb.close();

			expect(() =>
				walStore.commitReloadRevision({
					sessionId: "session-atomic-reload",
					expectedRevision: 1,
					events: [
						{ kind: "agent_message_chunk", payload: { text: "first" } },
						{ kind: "terminal_output", payload: { data: "second" } },
					],
				}),
			).toThrow("injected replay failure");

			expect(
				walStore.getSession("session-atomic-reload")?.currentRevision,
			).toBe(1);
			expect(
				walStore.queryEvents({
					sessionId: "session-atomic-reload",
					revision: 2,
				}),
			).toHaveLength(0);
			expect(walStore.getCurrentSeq("session-atomic-reload", 2)).toBe(0);

			const recoveryDb = new Database(dbPath);
			recoveryDb.exec("DROP TRIGGER fail_second_reload_event");
			recoveryDb.close();
			const recovered = walStore.commitReloadRevision({
				sessionId: "session-atomic-reload",
				expectedRevision: 1,
				events: [
					{ kind: "agent_message_chunk", payload: { text: "first" } },
					{ kind: "terminal_output", payload: { data: "second" } },
				],
			});
			expect(recovered.revision).toBe(2);
			expect(recovered.events.map((event) => event.seq)).toEqual([1, 2]);
			expect(walStore.getCurrentSeq("session-atomic-reload", 2)).toBe(2);
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
			walStore.recordMessageSendResult("session-1", "message-1", "end_turn");
			walStore.recordSessionRevisionKey("session-1", 1, "wrapped-dek");
			expect(walStore.getMessageSendResult("session-1", "message-1")).toEqual({
				stopReason: "end_turn",
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
			expect(
				walStore.getMessageSendResult("session-1", "message-1"),
			).toBeUndefined();
			expect(walStore.getSessionRevisionKey("session-1", 1)).toBeUndefined();

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

		it("rolls back every deletion when the archive tombstone cannot be written", () => {
			walStore.ensureSession({
				sessionId: "session-rollback",
				machineId: "machine-1",
				backendId: "backend-1",
			});
			walStore.appendEvent({
				sessionId: "session-rollback",
				revision: 1,
				kind: "agent_message_chunk",
				payload: { text: "must survive" },
			});
			walStore.recordMessageSendResult(
				"session-rollback",
				"message-1",
				"end_turn",
			);
			const pendingClaim = walStore.claimMessageSend(
				"session-rollback",
				"message-in-progress",
			);
			expect(pendingClaim.status).toBe("claimed");
			const faultDb = new Database(dbPath);
			faultDb.exec(`
				CREATE TRIGGER fail_archive_tombstone
				BEFORE INSERT ON archived_session_ids
				WHEN NEW.session_id = 'session-rollback'
				BEGIN
					SELECT RAISE(ABORT, 'injected archive failure');
				END;
			`);
			faultDb.close();

			expect(() => walStore.archiveSession("session-rollback")).toThrow(
				"injected archive failure",
			);

			expect(walStore.getSession("session-rollback")).not.toBeNull();
			expect(
				walStore.queryEvents({
					sessionId: "session-rollback",
					revision: 1,
				}),
			).toHaveLength(1);
			expect(
				walStore.getMessageSendResult("session-rollback", "message-1"),
			).toEqual({ stopReason: "end_turn" });
			expect(
				walStore.claimMessageSend("session-rollback", "message-in-progress"),
			).toEqual({ status: "in_progress" });
			expect(walStore.isArchived("session-rollback")).toBe(false);
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

	describe("discovered session workspace roots", () => {
		it("round-trips workspaceRootCwd for discovered sessions", () => {
			walStore.saveDiscoveredSessions([
				{
					sessionId: "session-1",
					backendId: "backend-1",
					cwd: "/home/user/project/apps/webui",
					workspaceRootCwd: "/home/user/project",
					discoveredAt: new Date().toISOString(),
					isStale: false,
				},
			]);

			const discovered = walStore.getDiscoveredSessions();
			expect(discovered).toHaveLength(1);
			expect(discovered[0].workspaceRootCwd).toBe("/home/user/project");
		});

		it("migrates legacy discovered sessions with a non-null fallback workspace root", () => {
			walStore.close();

			const db = new Database(dbPath);
			db.exec(`
				DROP TABLE IF EXISTS schema_version;
				CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
				INSERT INTO schema_version (version) VALUES (5);
				DROP TABLE IF EXISTS discovered_sessions;
				CREATE TABLE discovered_sessions (
					session_id TEXT PRIMARY KEY,
					backend_id TEXT NOT NULL,
					cwd TEXT,
					title TEXT,
					agent_updated_at TEXT,
					discovered_at TEXT NOT NULL,
					last_verified_at TEXT,
					is_stale INTEGER DEFAULT 0
				);
				INSERT INTO discovered_sessions (
					session_id,
					backend_id,
					cwd,
					discovered_at,
					is_stale
				) VALUES (
					'legacy-session',
					'backend-1',
					'/home/user/legacy',
					'2025-01-01T00:00:00.000Z',
					0
				);
			`);
			db.close();

			walStore = new WalStore(dbPath);

			const discovered = walStore.getDiscoveredSessions();
			expect(discovered).toHaveLength(1);
			expect(discovered[0].workspaceRootCwd).toBe("/home/user/legacy");
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
