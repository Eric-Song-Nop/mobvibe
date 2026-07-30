import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
