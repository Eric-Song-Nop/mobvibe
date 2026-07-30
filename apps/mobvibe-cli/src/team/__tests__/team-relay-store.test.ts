import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WalStore } from "../../wal/wal-store.js";
import { TeamRelayStore } from "../team-relay-store.js";

describe("TeamRelayStore operation journal", () => {
	let tempDir: string;
	let dbPath: string;
	let store: TeamRelayStore;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-relay-store-"));
		dbPath = path.join(tempDir, "events.db");
		store = new TeamRelayStore(dbPath);
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("claims once per source machine and never reclaims an in-progress operation", () => {
		const claimed = store.claimOperation({
			sourceMachineId: "leader-machine",
			operationId: "operation-1",
			requestDigest: "digest-1",
		});
		expect(claimed).toEqual({
			status: "claimed",
			claimId: expect.any(String),
		});

		expect(
			store.claimOperation({
				sourceMachineId: "leader-machine",
				operationId: "operation-1",
				requestDigest: "digest-1",
			}),
		).toEqual({ status: "in_progress" });
		expect(
			store.claimOperation({
				sourceMachineId: "leader-machine",
				operationId: "operation-1",
				requestDigest: "different-digest",
			}),
		).toEqual({ status: "conflict" });

		expect(
			store.claimOperation({
				sourceMachineId: "another-leader-machine",
				operationId: "operation-1",
				requestDigest: "digest-1",
			}),
		).toEqual({
			status: "claimed",
			claimId: expect.any(String),
		});
	});

	test("replays the exact completed result after restart", () => {
		const claim = store.claimOperation({
			sourceMachineId: "leader-machine",
			operationId: "operation-completed",
			requestDigest: "digest-completed",
		});
		if (claim.status !== "claimed") {
			throw new Error("Expected a new relay operation claim");
		}
		const result = {
			ok: true,
			session: { id: "session-1", metadata: [null, 42, "local"] },
		};

		expect(
			store.completeOperation({
				sourceMachineId: "leader-machine",
				operationId: "operation-completed",
				requestDigest: "digest-completed",
				claimId: claim.claimId,
				result,
			}),
		).toEqual(result);

		store.close();
		store = new TeamRelayStore(dbPath);
		expect(
			store.claimOperation({
				sourceMachineId: "leader-machine",
				operationId: "operation-completed",
				requestDigest: "digest-completed",
			}),
		).toEqual({ status: "completed", result });
	});

	test("replays the exact execution failure after restart", () => {
		const claim = store.claimOperation({
			sourceMachineId: "leader-machine",
			operationId: "operation-failed",
			requestDigest: "digest-failed",
		});
		if (claim.status !== "claimed") {
			throw new Error("Expected a new relay operation claim");
		}
		const error = {
			name: "RemoteSessionError",
			message: "ACP createSession failed",
			details: { retryable: false },
		};

		store.failOperation({
			sourceMachineId: "leader-machine",
			operationId: "operation-failed",
			requestDigest: "digest-failed",
			claimId: claim.claimId,
			error,
		});

		store.close();
		store = new TeamRelayStore(dbPath);
		expect(
			store.claimOperation({
				sourceMachineId: "leader-machine",
				operationId: "operation-failed",
				requestDigest: "digest-failed",
			}),
		).toEqual({ status: "failed", error });
	});

	test("keeps an operation in progress when result persistence fails", () => {
		const claim = store.claimOperation({
			sourceMachineId: "leader-machine",
			operationId: "operation-unknown",
			requestDigest: "digest-unknown",
		});
		if (claim.status !== "claimed") {
			throw new Error("Expected a new relay operation claim");
		}
		const circularResult: { self?: unknown } = {};
		circularResult.self = circularResult;

		expect(() =>
			store.completeOperation({
				sourceMachineId: "leader-machine",
				operationId: "operation-unknown",
				requestDigest: "digest-unknown",
				claimId: claim.claimId,
				result: circularResult,
			}),
		).toThrow();

		store.close();
		store = new TeamRelayStore(dbPath);
		expect(
			store.claimOperation({
				sourceMachineId: "leader-machine",
				operationId: "operation-unknown",
				requestDigest: "digest-unknown",
			}),
		).toEqual({ status: "in_progress" });

		const db = new Database(dbPath, { readonly: true });
		try {
			const row = db
				.query(`
					SELECT status, result_local_json, completed_at
					FROM team_relay_operations
					WHERE source_machine_id = ? AND operation_id = ?
				`)
				.get("leader-machine", "operation-unknown");
			expect(row).toEqual({
				status: "in_progress",
				result_local_json: null,
				completed_at: null,
			});
		} finally {
			db.close();
		}
	});
});

describe("TeamRelayStore remote session bindings", () => {
	let tempDir: string;
	let dbPath: string;
	let store: TeamRelayStore;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-binding-store-"));
		dbPath = path.join(tempDir, "events.db");
		store = new TeamRelayStore(dbPath);
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("creates a pre-session binding and resolves it by logical or server identity", () => {
		const created = store.createRemoteSessionBinding({
			serverId: "mobvibe-team:team-1:member-1",
			agentTeamId: "team-1",
			memberId: "member-1",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});

		expect(created).toEqual({
			serverId: "mobvibe-team:team-1:member-1",
			agentTeamId: "team-1",
			memberId: "member-1",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
			lifecycle: "creating",
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
		});
		expect(
			store.getRemoteSessionBinding({
				agentTeamId: "team-1",
				memberId: "member-1",
			}),
		).toEqual(created);
		expect(
			store.getRemoteSessionBindingByServerId("mobvibe-team:team-1:member-1"),
		).toEqual(created);
		expect(store.getRemoteSessionBindingBySessionId("not-created-yet")).toBe(
			undefined,
		);
		expect(store.listRemoteSessionBindings()).toEqual([created]);
	});

	test("activates and recovers routing by session or server id after restart", () => {
		store.createRemoteSessionBinding({
			serverId: "mobvibe-team:team-1:member-1",
			agentTeamId: "team-1",
			memberId: "member-1",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});
		const active = store.activateRemoteSessionBinding({
			serverId: "mobvibe-team:team-1:member-1",
			sessionId: "session-1",
		});
		expect(active).toEqual(
			expect.objectContaining({
				sessionId: "session-1",
				lifecycle: "active",
			}),
		);

		store.close();
		store = new TeamRelayStore(dbPath);
		expect(store.getRemoteSessionBindingBySessionId("session-1")).toEqual(
			active,
		);
		expect(
			store.getRemoteSessionBindingByServerId("mobvibe-team:team-1:member-1"),
		).toEqual(active);
	});

	test("enforces unique logical members and unique attached sessions", () => {
		store.createRemoteSessionBinding({
			serverId: "server-1",
			agentTeamId: "team-1",
			memberId: "member-1",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});
		expect(() =>
			store.createRemoteSessionBinding({
				serverId: "another-server",
				agentTeamId: "team-1",
				memberId: "member-1",
				leaderMachineId: "leader-machine",
				backendId: "backend-1",
			}),
		).toThrow();

		store.createRemoteSessionBinding({
			serverId: "server-2",
			agentTeamId: "team-1",
			memberId: "member-2",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});
		store.activateRemoteSessionBinding({
			serverId: "server-1",
			sessionId: "session-1",
		});
		expect(() =>
			store.activateRemoteSessionBinding({
				serverId: "server-2",
				sessionId: "session-1",
			}),
		).toThrow();
		expect(store.getRemoteSessionBindingByServerId("server-2")).toEqual(
			expect.objectContaining({
				lifecycle: "creating",
			}),
		);
		expect(
			store.getRemoteSessionBindingByServerId("server-2")?.sessionId,
		).toBeUndefined();
	});

	test("marks failed bindings and removes routing records", () => {
		store.createRemoteSessionBinding({
			serverId: "server-failed",
			agentTeamId: "team-1",
			memberId: "member-failed",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});

		expect(store.failRemoteSessionBinding("server-failed")).toEqual(
			expect.objectContaining({ lifecycle: "failed" }),
		);
		expect(store.removeRemoteSessionBinding("server-failed")).toBeTrue();
		expect(store.removeRemoteSessionBinding("server-failed")).toBeFalse();
		expect(
			store.getRemoteSessionBindingByServerId("server-failed"),
		).toBeUndefined();
	});
});

describe("TeamRelayStore remote runtime outbox", () => {
	let tempDir: string;
	let dbPath: string;
	let store: TeamRelayStore;
	let walStore: WalStore;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-runtime-outbox-"));
		dbPath = path.join(tempDir, "events.db");
		walStore = new WalStore(dbPath);
		store = new TeamRelayStore(dbPath);
	});

	afterEach(() => {
		store.close();
		walStore.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const activateRemoteSession = (sessionId = "remote-session-1") => {
		walStore.ensureSession({
			sessionId,
			machineId: "worker-machine",
			backendId: "backend-1",
		});
		store.createRemoteSessionBinding({
			serverId: `mobvibe-team:team-1:member-1:${sessionId}`,
			agentTeamId: "team-1",
			memberId: "member-1",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});
		store.activateRemoteSessionBinding({
			serverId: `mobvibe-team:team-1:member-1:${sessionId}`,
			sessionId,
		});
	};

	const appendTurnEnd = (sessionId = "remote-session-1") =>
		walStore.appendEvent({
			sessionId,
			revision: 1,
			kind: "turn_end",
			payload: { stopReason: "end_turn" },
		});

	test("atomically enqueues one typed completion and recovers it after restart", () => {
		activateRemoteSession();
		const terminalEvent = appendTurnEnd();
		const [queued] = store.listRuntimeOutbox();
		if (!queued) {
			throw new Error("Expected a queued runtime completion");
		}

		expect(queued).toEqual({
			operationId: expect.stringMatching(/^team-runtime:v1:[0-9a-f]{64}$/),
			id: expect.any(Number),
			protocolVersion: 1,
			eventType: "turn_completed",
			targetMachineId: "leader-machine",
			agentTeamId: "team-1",
			memberId: "member-1",
			sourceSessionId: "remote-session-1",
			sourceRevision: terminalEvent.revision,
			sourceSeq: terminalEvent.seq,
			status: "pending",
			attemptCount: 0,
			nextAttemptAt: terminalEvent.createdAt,
			leaseId: undefined,
			leaseExpiresAt: undefined,
			lastErrorCode: undefined,
			lastAttemptAt: undefined,
			deliveredAt: undefined,
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
		});

		store.close();
		store = new TeamRelayStore(dbPath);
		expect(store.listRuntimeOutbox()).toEqual([queued]);
	});

	test("reclaims expired leases and accepts only the current delivery claim", () => {
		activateRemoteSession();
		appendTurnEnd();
		const firstClaim = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:00:00.000Z",
			leaseExpiresAt: "2099-01-01T00:01:00.000Z",
			limit: 10,
		});
		expect(firstClaim).toHaveLength(1);
		expect(firstClaim[0]).toEqual(
			expect.objectContaining({
				status: "in_flight",
				attemptCount: 1,
				leaseId: expect.any(String),
				leaseExpiresAt: "2099-01-01T00:01:00.000Z",
				lastAttemptAt: "2099-01-01T00:00:00.000Z",
			}),
		);
		expect(
			store.claimDueRuntimeOutbox({
				now: "2099-01-01T00:00:30.000Z",
				leaseExpiresAt: "2099-01-01T00:01:30.000Z",
				limit: 10,
			}),
		).toEqual([]);

		const reclaimed = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:01:00.000Z",
			leaseExpiresAt: "2099-01-01T00:02:00.000Z",
			limit: 10,
		});
		expect(reclaimed).toHaveLength(1);
		if (!firstClaim[0] || !reclaimed[0]) {
			throw new Error("Expected runtime outbox claims");
		}
		expect(reclaimed[0]).toEqual(
			expect.objectContaining({
				attemptCount: 2,
			}),
		);
		expect(reclaimed[0].leaseId).not.toBe(firstClaim[0].leaseId);
		expect(() =>
			store.markRuntimeOutboxDelivered({
				id: firstClaim[0].id,
				leaseId: firstClaim[0].leaseId,
				deliveredAt: "2099-01-01T00:01:01.000Z",
			}),
		).toThrow("claim is no longer active");
		expect(
			store.markRuntimeOutboxDelivered({
				id: reclaimed[0].id,
				leaseId: reclaimed[0].leaseId,
				deliveredAt: "2099-01-01T00:01:01.000Z",
			}),
		).toEqual(
			expect.objectContaining({
				status: "delivered",
				deliveredAt: "2099-01-01T00:01:01.000Z",
				leaseId: undefined,
				leaseExpiresAt: undefined,
			}),
		);
	});

	test("persists backoff and does not claim a later turn ahead of its member", () => {
		activateRemoteSession();
		appendTurnEnd();
		appendTurnEnd();
		const [claimed] = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:00:00.000Z",
			leaseExpiresAt: "2099-01-01T00:01:00.000Z",
			limit: 10,
		});
		if (!claimed) {
			throw new Error("Expected the oldest completion claim");
		}
		const deferred = store.rescheduleRuntimeOutbox({
			id: claimed.id,
			leaseId: claimed.leaseId,
			nextAttemptAt: "2099-01-01T00:05:00.000Z",
			errorCode: "TRANSPORT_UNAVAILABLE",
			rescheduledAt: "2099-01-01T00:00:01.000Z",
		});

		expect(deferred).toEqual(
			expect.objectContaining({
				status: "pending",
				attemptCount: 1,
				nextAttemptAt: "2099-01-01T00:05:00.000Z",
				lastErrorCode: "TRANSPORT_UNAVAILABLE",
				leaseId: undefined,
				updatedAt: "2099-01-01T00:00:01.000Z",
			}),
		);
		expect(
			store.claimDueRuntimeOutbox({
				now: "2099-01-01T00:04:59.999Z",
				leaseExpiresAt: "2099-01-01T00:06:00.000Z",
				limit: 10,
			}),
		).toEqual([]);
		expect(
			store.claimDueRuntimeOutbox({
				now: "2099-01-01T00:05:00.000Z",
				leaseExpiresAt: "2099-01-01T00:06:00.000Z",
				limit: 10,
			})[0],
		).toEqual(expect.objectContaining({ id: claimed.id, attemptCount: 2 }));
	});

	test("reports only the next actionable member head for timer scheduling", () => {
		expect(store.getNextRuntimeOutboxDueAt()).toBeUndefined();
		activateRemoteSession();
		appendTurnEnd();
		appendTurnEnd();
		const [, second] = store.listRuntimeOutbox();
		if (!second?.nextAttemptAt) {
			throw new Error("Expected a second pending completion");
		}
		const [claimed] = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:00:00.000Z",
			leaseExpiresAt: "2099-01-01T00:01:00.000Z",
		});
		if (!claimed) {
			throw new Error("Expected the member head to be claimed");
		}

		expect(store.getNextRuntimeOutboxDueAt()).toBe("2099-01-01T00:01:00.000Z");
		store.rescheduleRuntimeOutbox({
			id: claimed.id,
			leaseId: claimed.leaseId,
			nextAttemptAt: "2099-01-01T00:05:00.000Z",
			errorCode: "TRANSPORT_UNAVAILABLE",
			rescheduledAt: "2099-01-01T00:00:01.000Z",
		});
		expect(store.getNextRuntimeOutboxDueAt()).toBe("2099-01-01T00:05:00.000Z");

		const [reclaimed] = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:05:00.000Z",
			leaseExpiresAt: "2099-01-01T00:06:00.000Z",
		});
		if (!reclaimed) {
			throw new Error("Expected the deferred member head to be reclaimed");
		}
		store.markRuntimeOutboxDelivered({
			id: reclaimed.id,
			leaseId: reclaimed.leaseId,
			deliveredAt: "2099-01-01T00:05:01.000Z",
		});
		expect(store.getNextRuntimeOutboxDueAt()).toBe(second.nextAttemptAt);
	});

	test("persists a permanent failure only for its current lease", () => {
		activateRemoteSession();
		appendTurnEnd();
		const [claimed] = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:00:00.000Z",
			leaseExpiresAt: "2099-01-01T00:01:00.000Z",
		});
		if (!claimed) {
			throw new Error("Expected a runtime completion claim");
		}

		expect(
			store.failRuntimeOutbox({
				id: claimed.id,
				leaseId: claimed.leaseId,
				errorCode: "REMOTE_MEMBER_REJECTED",
				failedAt: "2099-01-01T00:00:01.000Z",
			}),
		).toEqual(
			expect.objectContaining({
				status: "failed",
				lastErrorCode: "REMOTE_MEMBER_REJECTED",
				nextAttemptAt: undefined,
				leaseId: undefined,
			}),
		);
		expect(() =>
			store.failRuntimeOutbox({
				id: claimed.id,
				leaseId: claimed.leaseId,
				errorCode: "STALE_CLAIM",
				failedAt: "2099-01-01T00:00:02.000Z",
			}),
		).toThrow("claim is no longer active");
	});

	test("deletes only the oldest delivered runtime entries within a bounded batch", () => {
		activateRemoteSession();
		appendTurnEnd();
		appendTurnEnd();
		appendTurnEnd();
		appendTurnEnd();

		const claimNext = () => {
			const [claimed] = store.claimDueRuntimeOutbox({
				now: "2099-01-01T00:00:00.000Z",
				leaseExpiresAt: "2099-01-01T00:01:00.000Z",
			});
			if (!claimed) {
				throw new Error("Expected a runtime completion claim");
			}
			return claimed;
		};

		const first = claimNext();
		store.markRuntimeOutboxDelivered({
			id: first.id,
			leaseId: first.leaseId,
			deliveredAt: "2099-01-01T00:00:01.000Z",
		});
		const second = claimNext();
		store.markRuntimeOutboxDelivered({
			id: second.id,
			leaseId: second.leaseId,
			deliveredAt: "2099-01-01T00:00:02.000Z",
		});
		const failed = claimNext();
		store.failRuntimeOutbox({
			id: failed.id,
			leaseId: failed.leaseId,
			errorCode: "REMOTE_MEMBER_REJECTED",
			failedAt: "2099-01-01T00:00:03.000Z",
		});

		expect(
			store.deleteDeliveredRuntimeOutbox({
				deliveredBefore: "2099-01-01T00:00:03.000Z",
				limit: 1,
			}),
		).toBe(1);
		expect(store.listRuntimeOutbox()).toEqual([
			expect.objectContaining({ id: second.id, status: "delivered" }),
			expect.objectContaining({ id: failed.id, status: "failed" }),
			expect.objectContaining({ status: "pending" }),
		]);

		expect(
			store.deleteDeliveredRuntimeOutbox({
				deliveredBefore: "2099-01-01T00:00:03.000Z",
				limit: 10,
			}),
		).toBe(1);
		expect(store.listRuntimeOutbox()).toEqual([
			expect.objectContaining({ id: failed.id, status: "failed" }),
			expect.objectContaining({ status: "pending" }),
		]);
	});

	test("validates cleanup bounds and keeps a delivery exactly at the cutoff", () => {
		activateRemoteSession();
		appendTurnEnd();
		const [claimed] = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:00:00.000Z",
			leaseExpiresAt: "2099-01-01T00:01:00.000Z",
		});
		if (!claimed) {
			throw new Error("Expected a runtime completion claim");
		}
		store.markRuntimeOutboxDelivered({
			id: claimed.id,
			leaseId: claimed.leaseId,
			deliveredAt: "2099-01-01T00:00:01.000Z",
		});

		expect(
			store.deleteDeliveredRuntimeOutbox({
				deliveredBefore: "2099-01-01T00:00:01.000Z",
				limit: 1,
			}),
		).toBe(0);
		for (const limit of [0, 101, 1.5]) {
			expect(() =>
				store.deleteDeliveredRuntimeOutbox({
					deliveredBefore: "2099-01-01T00:00:02.000Z",
					limit,
				}),
			).toThrow("cleanup limit must be between 1 and 100");
		}
	});

	test("preserves member FIFO when its worker session is replaced", () => {
		activateRemoteSession("remote-session-old");
		appendTurnEnd("remote-session-old");
		store.removeRemoteSessionBinding(
			"mobvibe-team:team-1:member-1:remote-session-old",
		);
		activateRemoteSession("remote-session-new");
		appendTurnEnd("remote-session-new");

		const claimed = store.claimDueRuntimeOutbox({
			now: "2099-01-01T00:00:00.000Z",
			leaseExpiresAt: "2099-01-01T00:01:00.000Z",
			limit: 10,
		});
		expect(claimed).toHaveLength(1);
		expect(claimed[0]?.sourceSessionId).toBe("remote-session-old");
	});

	test("does not create runtime work for an ordinary or inactive binding", () => {
		walStore.ensureSession({
			sessionId: "ordinary-session",
			machineId: "worker-machine",
			backendId: "backend-1",
		});
		appendTurnEnd("ordinary-session");

		walStore.ensureSession({
			sessionId: "creating-session",
			machineId: "worker-machine",
			backendId: "backend-1",
		});
		store.createRemoteSessionBinding({
			serverId: "creating-server",
			agentTeamId: "team-creating",
			memberId: "member-creating",
			leaderMachineId: "leader-machine",
			backendId: "backend-1",
		});
		appendTurnEnd("creating-session");

		expect(store.listRuntimeOutbox()).toEqual([]);
	});

	test("rolls back the terminal WAL event when durable enqueue fails", () => {
		activateRemoteSession();
		const db = new Database(dbPath);
		try {
			db.exec(`
				CREATE TRIGGER reject_team_runtime_outbox
				BEFORE INSERT ON team_runtime_outbox
				BEGIN
					SELECT RAISE(ABORT, 'forced runtime outbox failure');
				END;
			`);
		} finally {
			db.close();
		}

		expect(() => appendTurnEnd()).toThrow("forced runtime outbox failure");
		expect(
			walStore.queryEvents({
				sessionId: "remote-session-1",
				revision: 1,
			}),
		).toEqual([]);
		expect(store.listRuntimeOutbox()).toEqual([]);
	});

	test("keeps committed work after its runtime binding is removed", () => {
		activateRemoteSession();
		appendTurnEnd();
		expect(
			store.removeRemoteSessionBinding(
				"mobvibe-team:team-1:member-1:remote-session-1",
			),
		).toBeTrue();

		expect(store.listRuntimeOutbox()).toHaveLength(1);
	});

	test("counts an isolated runtime outbox row as durable local data", () => {
		activateRemoteSession();
		appendTurnEnd();
		const db = new Database(dbPath);
		try {
			db.exec(`
				DELETE FROM session_events;
				DELETE FROM sessions;
				DELETE FROM remote_team_session_bindings;
			`);
		} finally {
			db.close();
		}

		expect(store.listRuntimeOutbox()).toHaveLength(1);
		expect(walStore.hasDurableData()).toBeTrue();
	});
});
