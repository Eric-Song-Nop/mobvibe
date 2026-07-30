import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../wal/migrations.js";
import { WalStore } from "../../wal/wal-store.js";
import { AgentTeamStore } from "../agent-team-store.js";
import { assertGatewayFacingAgentTeamPayload } from "../content-boundary.js";

describe("AgentTeamStore durable metadata", () => {
	let tempDir: string;
	let dbPath: string;
	let store: AgentTeamStore;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-store-"));
		dbPath = path.join(tempDir, "events.db");
		store = new AgentTeamStore(dbPath);
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("creates team metadata, one leader, and initial MCP status", () => {
		const result = store.createAgentTeam({
			machineId: "machine-1",
			backendId: "backend-claude",
			workspaceRootCwd: "/workspace/project",
			title: "Refactor API",
			workspaceMode: "per_member_worktree",
			leaderName: "Lead Agent",
		});

		expect(result.team.agentTeamId).toBeString();
		expect(result.team.leaderMemberId).toBeString();
		expect(result.team.machineId).toBe("machine-1");
		expect(result.team.workspaceRootCwd).toBe("/workspace/project");
		expect(result.team.lifecycle).toBe("pending");
		expect(result.team.workspaceMode).toBe("per_member_worktree");
		expect(result.team.members).toHaveLength(1);
		expect(result.team.members[0]).toEqual(
			expect.objectContaining({
				memberId: result.team.leaderMemberId,
				agentTeamId: result.team.agentTeamId,
				role: "leader",
				name: "Lead Agent",
				backendId: "backend-claude",
				lifecycle: "pending",
				health: "healthy",
				pendingPermissionCount: 0,
			}),
		);
		expect(result.team.members[0].sessionId).toBeUndefined();
		expect(result.team.members[0].mcp).toEqual(
			expect.objectContaining({
				transport: "acp",
				phase: "not_started",
			}),
		);

		const db = new Database(dbPath, { readonly: true });
		try {
			const teamCount = db
				.query(
					"SELECT COUNT(*) as count FROM agent_teams WHERE agent_team_id = $agentTeamId",
				)
				.get({ $agentTeamId: result.team.agentTeamId }) as { count: number };
			const leaderCount = db
				.query(
					"SELECT COUNT(*) as count FROM agent_team_members WHERE agent_team_id = $agentTeamId AND role = 'leader'",
				)
				.get({ $agentTeamId: result.team.agentTeamId }) as { count: number };
			const mcpCount = db
				.query(
					"SELECT COUNT(*) as count FROM agent_team_mcp_status WHERE agent_team_id = $agentTeamId AND phase = 'not_started'",
				)
				.get({ $agentTeamId: result.team.agentTeamId }) as { count: number };

			expect(teamCount.count).toBe(1);
			expect(leaderCount.count).toBe(1);
			expect(mcpCount.count).toBe(1);
		} finally {
			db.close();
		}
	});

	test("rejects a member whose team does not exist", () => {
		expect(() =>
			store.addTeamMember({
				agentTeamId: "missing-team",
				backendId: "backend-claude",
				name: "Orphan member",
			}),
		).toThrow("FOREIGN KEY constraint failed");
	});

	test("rejects a mailbox message whose team does not exist", () => {
		expect(() =>
			store.createMailboxMessages({
				agentTeamId: "missing-team",
				fromMemberId: "missing-sender",
				recipients: [
					{
						memberId: "missing-recipient",
						name: "Missing recipient",
					},
				],
				body: { message: "orphan message" },
			}),
		).toThrow("FOREIGN KEY constraint failed");
	});

	test("rejects a task whose team does not exist", () => {
		expect(() =>
			store.createTeamTask({
				agentTeamId: "missing-team",
				ownerMemberId: null,
				status: "todo",
				body: { title: "Orphan task" },
				blockedBy: [],
			}),
		).toThrow("FOREIGN KEY constraint failed");
	});

	test("rejects a tool intent whose team does not exist", () => {
		expect(() =>
			store.createTeamToolIntent({
				agentTeamId: "missing-team",
				requestedByMemberId: "missing-member",
				kind: "spawn_member",
				payload: {},
				sourceRefs: [],
			}),
		).toThrow("FOREIGN KEY constraint failed");
	});

	test("recovers stable metadata after reopening the same SQLite file", () => {
		const created = store.createAgentTeam({
			machineId: "machine-1",
			backendId: "backend-claude",
			workspaceRootCwd: "/workspace/project",
			title: "Persistent Team",
		});

		store.close();
		store = new AgentTeamStore(dbPath);

		const listed = store.listAgentTeams().teams;
		const recovered = store.getAgentTeam({
			agentTeamId: created.team.agentTeamId,
		}).team;

		expect(listed).toHaveLength(1);
		expect(recovered?.agentTeamId).toBe(created.team.agentTeamId);
		expect(recovered?.leaderMemberId).toBe(created.team.leaderMemberId);
		expect(recovered?.machineId).toBe(created.team.machineId);
		expect(recovered?.workspaceRootCwd).toBe(created.team.workspaceRootCwd);
		expect(recovered?.lifecycle).toBe(created.team.lifecycle);
		expect(recovered?.createdAt).toBe(created.team.createdAt);
		expect(recovered?.updatedAt).toBe(created.team.updatedAt);
	});

	test("projects counts, source refs, and safe status without local content", () => {
		const created = store.createAgentTeam({
			machineId: "machine-1",
			backendId: "backend-claude",
			workspaceRootCwd: "/workspace/project",
			title: "Projection Team",
		});
		const team = created.team;
		const member = team.members[0];
		const mailboxAt = "2026-05-13T00:00:00.000Z";
		const taskAt = "2026-05-13T00:01:00.000Z";
		const db = new Database(dbPath);

		try {
			db.query(
				`INSERT INTO agent_team_mailbox_messages (
					message_id, agent_team_id, from_member_id, to_member_id, body_local_json,
					source_refs_json, read_at, wake_status, created_at
				) VALUES (
					$messageId, $agentTeamId, $fromMemberId, $toMemberId, $bodyLocalJson,
					$sourceRefsJson, NULL, $wakeStatus, $createdAt
				)`,
			).run({
				$messageId: "message-1",
				$agentTeamId: team.agentTeamId,
				$fromMemberId: member.memberId,
				$toMemberId: member.memberId,
				$bodyLocalJson: JSON.stringify({
					body: "local mailbox body",
					prompt: "local prompt",
				}),
				$sourceRefsJson: JSON.stringify([
					{
						type: "member_session",
						agentTeamId: team.agentTeamId,
						memberId: member.memberId,
						sessionId: "session-1",
					},
				]),
				$wakeStatus: "failed",
				$createdAt: mailboxAt,
			});
			db.query(
				`INSERT INTO agent_team_tasks (
					task_id, agent_team_id, owner_member_id, status, body_local_json,
					blocked_by_json, blocks_json, source_refs_json, created_at, updated_at
				) VALUES (
					$taskId, $agentTeamId, $ownerMemberId, $status, $bodyLocalJson,
					$blockedByJson, $blocksJson, $sourceRefsJson, $createdAt, $updatedAt
				)`,
			).run({
				$taskId: "task-1",
				$agentTeamId: team.agentTeamId,
				$ownerMemberId: member.memberId,
				$status: "blocked",
				$bodyLocalJson: JSON.stringify({
					description: "local task description",
					agentOutput: "local output",
				}),
				$blockedByJson: JSON.stringify([]),
				$blocksJson: JSON.stringify([]),
				$sourceRefsJson: JSON.stringify([
					{
						type: "task",
						agentTeamId: team.agentTeamId,
						taskId: "task-1",
						ownerMemberId: member.memberId,
					},
				]),
				$createdAt: taskAt,
				$updatedAt: taskAt,
			});
			db.query(
				`INSERT INTO agent_team_summary_refs (
					summary_ref_id, agent_team_id, source_refs_json, status, created_at, updated_at
				) VALUES (
					$summaryRefId, $agentTeamId, $sourceRefsJson, $status, $createdAt, $updatedAt
				)`,
			).run({
				$summaryRefId: "summary-ref-1",
				$agentTeamId: team.agentTeamId,
				$sourceRefsJson: JSON.stringify([
					{
						type: "mailbox_message",
						agentTeamId: team.agentTeamId,
						messageId: "message-1",
						fromMemberId: member.memberId,
						toMemberId: member.memberId,
					},
				]),
				$status: "ready",
				$createdAt: taskAt,
				$updatedAt: taskAt,
			});
		} finally {
			db.close();
		}

		const projected = store.getAgentTeam({
			agentTeamId: team.agentTeamId,
		}).team;
		const serialized = JSON.stringify(projected);

		expect(projected?.mailboxCounts).toEqual({
			unread: 1,
			wakePending: 0,
			wakeFailed: 1,
			lastMailboxAt: mailboxAt,
		});
		expect(projected?.taskCounts.blocked).toBe(1);
		expect(projected?.taskCounts.lastTaskUpdatedAt).toBe(taskAt);
		expect(projected?.summaryRefs?.[0]).toEqual(
			expect.objectContaining({
				summaryRefId: "summary-ref-1",
				status: "ready",
			}),
		);
		expect(projected?.summaryRefs?.[0].sourceRefs[0]).toEqual(
			expect.objectContaining({
				type: "mailbox_message",
				messageId: "message-1",
			}),
		);
		expect(serialized).not.toContain("local mailbox body");
		expect(serialized).not.toContain("local task description");
		expect(serialized).not.toContain("local output");
		expect(serialized).not.toContain("body_local_json");
	});

	test("recovers MCP readiness and summary refs independently from lifecycle", () => {
		const created = store.createAgentTeam({
			machineId: "machine-1",
			backendId: "backend-claude",
			workspaceRootCwd: "/workspace/project",
			title: "MCP Recovery Team",
		});
		const team = created.team;
		const member = team.members[0];
		const updatedAt = "2026-05-13T04:40:00.000Z";
		const summaryRefSource = {
			type: "task" as const,
			agentTeamId: team.agentTeamId,
			taskId: "task-1",
			ownerMemberId: member.memberId,
		};
		const db = new Database(dbPath);

		try {
			db.query(
				`UPDATE agent_teams
				 SET lifecycle = 'running', updated_at = $updatedAt
				 WHERE agent_team_id = $agentTeamId`,
			).run({ $agentTeamId: team.agentTeamId, $updatedAt: updatedAt });
			db.query(
				`UPDATE agent_team_members
				 SET lifecycle = 'running', updated_at = $updatedAt
				 WHERE member_id = $memberId`,
			).run({ $memberId: member.memberId, $updatedAt: updatedAt });
			db.query(
				`UPDATE agent_team_mcp_status
				 SET phase = 'tools_waiting', updated_at = $updatedAt
				 WHERE agent_team_id = $agentTeamId AND member_id = $memberId`,
			).run({
				$agentTeamId: team.agentTeamId,
				$memberId: member.memberId,
				$updatedAt: updatedAt,
			});
			db.query(
				`INSERT INTO agent_team_summary_refs (
					summary_ref_id, agent_team_id, source_refs_json, status, created_at, updated_at
				) VALUES (
					$summaryRefId, $agentTeamId, $sourceRefsJson, $status, $createdAt, $updatedAt
				)`,
			).run({
				$summaryRefId: "summary-ref-2",
				$agentTeamId: team.agentTeamId,
				$sourceRefsJson: JSON.stringify([summaryRefSource]),
				$status: "ready",
				$createdAt: updatedAt,
				$updatedAt: updatedAt,
			});
		} finally {
			db.close();
		}

		store.close();
		store = new AgentTeamStore(dbPath);
		const recovered = store.getAgentTeam({
			agentTeamId: team.agentTeamId,
		}).team;
		const serialized = JSON.stringify(recovered);

		expect(recovered?.lifecycle).toBe("running");
		expect(recovered?.members[0].lifecycle).toBe("running");
		expect(recovered?.members[0].mcp?.phase).toBe("tools_waiting");
		expect(recovered?.summaryRefs?.[0]).toEqual(
			expect.objectContaining({
				summaryRefId: "summary-ref-2",
				status: "ready",
				sourceRefs: [summaryRefSource],
			}),
		);
		expect(serialized).not.toContain("summaryText");
		expect(serialized).not.toContain("local summary");
	});

	test("updates team and member runtime state without leaking forbidden content", () => {
		const created = store.createAgentTeam({
			machineId: "machine-1",
			backendId: "backend-claude",
			workspaceRootCwd: "/workspace/project",
			title: "Runtime Team",
		});
		const team = created.team;
		const leaderMemberId = team.leaderMemberId;

		store.updateTeamRuntimeState({
			agentTeamId: team.agentTeamId,
			lifecycle: "running",
		});
		store.updateTeamMemberRuntime({
			agentTeamId: team.agentTeamId,
			memberId: leaderMemberId,
			sessionId: "leader-session-1",
			lifecycle: "running",
			health: "healthy",
			worktreeSourceCwd: "/workspace/project",
			worktreeBranch: "agent-team-branch",
		});

		const projected = store.getAgentTeam({
			agentTeamId: team.agentTeamId,
		}).team;
		const leader = projected?.members[0];
		const serialized = JSON.stringify(projected);

		expect(projected?.lifecycle).toBe("running");
		expect(leader).toEqual(
			expect.objectContaining({
				memberId: leaderMemberId,
				sessionId: "leader-session-1",
				lifecycle: "running",
				health: "healthy",
				worktreeSourceCwd: "/workspace/project",
				worktreeBranch: "agent-team-branch",
			}),
		);
		expect(serialized).not.toContain("body_local_json");
		expect(serialized).not.toContain("prompt");
		expect(serialized).not.toContain("providerToken");
	});

	test("projects failed team and leader runtime state with safe error metadata", () => {
		const created = store.createAgentTeam({
			machineId: "machine-1",
			backendId: "backend-claude",
			workspaceRootCwd: "/workspace/project",
			title: "Failed Runtime Team",
		});
		const team = created.team;

		store.updateTeamRuntimeState({
			agentTeamId: team.agentTeamId,
			lifecycle: "failed",
		});
		store.updateTeamMemberRuntime({
			agentTeamId: team.agentTeamId,
			memberId: team.leaderMemberId,
			lifecycle: "failed",
			health: "error",
			error: {
				code: "TEAM_CREATE_FAILED",
				message: "Leader session failed before MCP readiness",
				retryable: false,
				scope: "session",
			},
		});

		const projected = store.getAgentTeam({
			agentTeamId: team.agentTeamId,
		}).team;
		const leader = projected?.members[0];
		const serialized = JSON.stringify(projected);

		expect(projected?.lifecycle).toBe("failed");
		expect(leader).toEqual(
			expect.objectContaining({
				memberId: team.leaderMemberId,
				lifecycle: "failed",
				health: "error",
				error: expect.objectContaining({
					code: "TEAM_CREATE_FAILED",
					message: "Leader session failed before MCP readiness",
				}),
			}),
		);
		expect(serialized).not.toContain("body_local_json");
		expect(serialized).not.toContain("prompt");
		expect(serialized).not.toContain("providerToken");
	});

	test("binds a leader-local remote execution route idempotently and recovers it", () => {
		const created = store.createAgentTeam({
			machineId: "leader-machine",
			backendId: "backend-leader",
			workspaceRootCwd: "/workspace/project",
			title: "Remote execution Team",
		});
		const { memberId } = store.addTeamMember({
			agentTeamId: created.team.agentTeamId,
			backendId: "backend-worker",
			name: "Remote worker",
		});
		const bindingParams = {
			agentTeamId: created.team.agentTeamId,
			memberId,
			executionMachineId: "worker-machine",
			workerRelayKeyId: "worker-relay-key",
			bootstrapOperationId: "bootstrap-operation",
		};

		const first = store.bindTeamMemberExecution(bindingParams);
		const replay = store.bindTeamMemberExecution(bindingParams);

		expect(replay).toEqual(first);
		expect(
			store.getTeamMemberExecution(created.team.agentTeamId, memberId),
		).toEqual(first);
		expect(store.listTeamMemberExecutions(created.team.agentTeamId)).toEqual([
			first,
		]);

		store.close();
		store = new AgentTeamStore(dbPath);

		expect(
			store.getTeamMemberExecution(created.team.agentTeamId, memberId),
		).toEqual(first);
		expect(
			JSON.stringify(
				store.getAgentTeam({ agentTeamId: created.team.agentTeamId }).team,
			),
		).not.toContain("worker-machine");
	});

	test("rejects conflicting or invalid remote execution bindings", () => {
		const firstTeam = store.createAgentTeam({
			machineId: "leader-machine",
			backendId: "backend-leader",
			workspaceRootCwd: "/workspace/first",
		});
		const secondTeam = store.createAgentTeam({
			machineId: "leader-machine",
			backendId: "backend-leader",
			workspaceRootCwd: "/workspace/second",
		});
		const firstMember = store.addTeamMember({
			agentTeamId: firstTeam.team.agentTeamId,
			backendId: "backend-worker",
			name: "First worker",
		});
		const secondMember = store.addTeamMember({
			agentTeamId: secondTeam.team.agentTeamId,
			backendId: "backend-worker",
			name: "Second worker",
		});
		const binding = {
			agentTeamId: firstTeam.team.agentTeamId,
			memberId: firstMember.memberId,
			executionMachineId: "worker-machine",
			workerRelayKeyId: "worker-relay-key",
			bootstrapOperationId: "bootstrap-operation",
		};
		store.bindTeamMemberExecution(binding);

		for (const conflicting of [
			{ ...binding, executionMachineId: "other-machine" },
			{ ...binding, workerRelayKeyId: "other-relay-key" },
			{ ...binding, bootstrapOperationId: "other-bootstrap-operation" },
		]) {
			expect(() => store.bindTeamMemberExecution(conflicting)).toThrow(
				"execution binding conflict",
			);
		}
		expect(() =>
			store.bindTeamMemberExecution({
				...binding,
				agentTeamId: secondTeam.team.agentTeamId,
			}),
		).toThrow("Agent Team member not found");
		expect(() =>
			store.bindTeamMemberExecution({
				agentTeamId: firstTeam.team.agentTeamId,
				memberId: "missing-member",
				executionMachineId: "worker-machine",
				workerRelayKeyId: "worker-relay-key",
				bootstrapOperationId: "missing-member-bootstrap",
			}),
		).toThrow("Agent Team member not found");
		expect(() =>
			store.bindTeamMemberExecution({
				agentTeamId: secondTeam.team.agentTeamId,
				memberId: secondMember.memberId,
				executionMachineId: "worker-machine",
				workerRelayKeyId: "worker-relay-key",
				bootstrapOperationId: binding.bootstrapOperationId,
			}),
		).toThrow("bootstrap operation conflict");
	});

	test("removes remote execution bindings without exposing route metadata in projections", () => {
		const created = store.createAgentTeam({
			machineId: "leader-machine",
			backendId: "backend-leader",
			workspaceRootCwd: "/workspace/project",
		});
		const { memberId } = store.addTeamMember({
			agentTeamId: created.team.agentTeamId,
			backendId: "backend-worker",
			name: "Remote worker",
		});
		store.bindTeamMemberExecution({
			agentTeamId: created.team.agentTeamId,
			memberId,
			executionMachineId: "private-worker-machine",
			workerRelayKeyId: "private-worker-relay-key",
			bootstrapOperationId: "private-bootstrap-operation",
		});

		const serializedGet = JSON.stringify(
			store.getAgentTeam({ agentTeamId: created.team.agentTeamId }),
		);
		const serializedList = JSON.stringify(store.listAgentTeams());
		for (const forbidden of [
			"executionMachineId",
			"workerRelayKeyId",
			"bootstrapOperationId",
			"private-worker-machine",
			"private-worker-relay-key",
			"private-bootstrap-operation",
		]) {
			expect(serializedGet).not.toContain(forbidden);
			expect(serializedList).not.toContain(forbidden);
		}

		expect(
			store.removeTeamMemberExecution(created.team.agentTeamId, memberId),
		).toBe(true);
		expect(
			store.removeTeamMemberExecution(created.team.agentTeamId, memberId),
		).toBe(false);
		expect(
			store.getTeamMemberExecution(created.team.agentTeamId, memberId),
		).toBeNull();
	});
});

describe("Agent Team content boundary", () => {
	test("rejects nested forbidden keys and accepts safe projection metadata", () => {
		expect(() =>
			assertGatewayFacingAgentTeamPayload({
				agentTeamId: "team-1",
				members: [{ memberId: "member-1", status: "running" }],
				error: { code: "INTERNAL_ERROR", message: "safe", retryable: true },
			}),
		).not.toThrow();
		expect(() =>
			assertGatewayFacingAgentTeamPayload({
				agentTeamId: "team-1",
				nested: { description: "must stay local" },
			}),
		).toThrow("Forbidden Gateway-facing Agent Team key: description");
	});
});

describe("Agent Team migrations", () => {
	test("run from an empty database and preserve existing WAL session tables", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-migrate-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);
			const foreignKeys = db.query("PRAGMA foreign_keys").get() as {
				foreign_keys: number;
			};
			expect(foreignKeys.foreign_keys).toBe(1);

			const tableNames = db
				.query("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all() as Array<{ name: string }>;
			const names = tableNames.map((row) => row.name);

			expect(names).toContain("sessions");
			expect(names).toContain("session_events");
			expect(names).toContain("agent_teams");
			expect(names).toContain("agent_team_members");
			expect(names).toContain("agent_team_mcp_status");
			expect(names).toContain("agent_team_mailbox_messages");
			expect(names).toContain("agent_team_tasks");
			expect(names).toContain("agent_team_summary_refs");
			expect(names).toContain("agent_team_tool_intents");
			expect(names).toContain("agent_team_command_journal");
			expect(names).toContain("team_relay_operations");
			expect(names).toContain("remote_team_session_bindings");
			expect(names).toContain("agent_team_member_executions");
			expect(names).toContain("team_runtime_outbox");

			const mailboxColumns = db
				.query("PRAGMA table_info(agent_team_mailbox_messages)")
				.all() as Array<{ name: string }>;
			expect(mailboxColumns.map((column) => column.name)).toContain(
				"wake_error_json",
			);

			const schemaVersion = db
				.query("SELECT MAX(version) AS version FROM schema_version")
				.get() as { version: number };
			expect(schemaVersion.version).toBe(21);
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("creates operational relay tables without Team fact columns or foreign keys", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-relay-schema-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);

			const relayOperationColumns = db
				.query("PRAGMA table_info(team_relay_operations)")
				.all() as Array<{ name: string }>;
			expect(relayOperationColumns.map(({ name }) => name)).toEqual([
				"source_machine_id",
				"operation_id",
				"request_digest",
				"status",
				"claim_id",
				"result_local_json",
				"error_local_json",
				"claimed_at",
				"completed_at",
			]);

			const bindingColumns = db
				.query("PRAGMA table_info(remote_team_session_bindings)")
				.all() as Array<{ name: string }>;
			const bindingColumnNames = bindingColumns.map(({ name }) => name);
			expect(bindingColumnNames).toEqual([
				"server_id",
				"agent_team_id",
				"member_id",
				"leader_machine_id",
				"backend_id",
				"session_id",
				"lifecycle",
				"created_at",
				"updated_at",
			]);
			for (const forbiddenColumn of [
				"role",
				"name",
				"prompt",
				"task",
				"mailbox",
				"body",
				"worktree",
			]) {
				expect(bindingColumnNames).not.toContain(forbiddenColumn);
			}

			const relayForeignKeys = db
				.query("PRAGMA foreign_key_list(team_relay_operations)")
				.all();
			const bindingForeignKeys = db
				.query("PRAGMA foreign_key_list(remote_team_session_bindings)")
				.all();
			const runtimeOutboxColumns = db
				.query("PRAGMA table_info(team_runtime_outbox)")
				.all() as Array<{ name: string }>;
			const runtimeOutboxColumnNames = runtimeOutboxColumns.map(
				({ name }) => name,
			);
			expect(runtimeOutboxColumnNames).toEqual([
				"id",
				"source_session_id",
				"source_revision",
				"source_seq",
				"protocol_version",
				"event_type",
				"agent_team_id",
				"member_id",
				"target_machine_id",
				"status",
				"attempt_count",
				"next_attempt_at",
				"lease_id",
				"lease_expires_at",
				"last_error_code",
				"last_attempt_at",
				"delivered_at",
				"created_at",
				"updated_at",
			]);
			for (const forbiddenColumn of [
				"role",
				"name",
				"prompt",
				"task",
				"mailbox",
				"body",
				"worktree",
			]) {
				expect(runtimeOutboxColumnNames).not.toContain(forbiddenColumn);
			}
			const runtimeOutboxForeignKeys = db
				.query("PRAGMA foreign_key_list(team_runtime_outbox)")
				.all();
			const runtimeCaptureTrigger = db
				.query(`
					SELECT name
					FROM sqlite_master
					WHERE type = 'trigger'
						AND name = 'enqueue_team_runtime_after_turn_end'
				`)
				.get();
			const runtimeDeliveredIndex = db
				.query(`
					SELECT name
					FROM sqlite_master
					WHERE type = 'index'
						AND name = 'idx_team_runtime_outbox_delivered'
				`)
				.get();
			expect(relayForeignKeys).toEqual([]);
			expect(bindingForeignKeys).toEqual([]);
			expect(runtimeOutboxForeignKeys).toEqual([]);
			expect(runtimeCaptureTrigger).toEqual({
				name: "enqueue_team_runtime_after_turn_end",
			});
			expect(runtimeDeliveredIndex).toEqual({
				name: "idx_team_runtime_outbox_delivered",
			});
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("creates a leader-only member execution table with strict ownership and uniqueness", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-execution-schema-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);

			const columns = db
				.query("PRAGMA table_info(agent_team_member_executions)")
				.all() as Array<{ name: string }>;
			const columnNames = columns.map(({ name }) => name);
			expect(columnNames).toEqual([
				"agent_team_id",
				"member_id",
				"execution_machine_id",
				"worker_relay_key_id",
				"bootstrap_operation_id",
				"created_at",
				"updated_at",
			]);
			for (const forbiddenColumn of [
				"role",
				"name",
				"prompt",
				"task",
				"mailbox",
				"body",
				"worktree",
			]) {
				expect(columnNames).not.toContain(forbiddenColumn);
			}

			const foreignKeys = db
				.query("PRAGMA foreign_key_list(agent_team_member_executions)")
				.all() as Array<{
				table: string;
				from: string;
				to: string;
				on_delete: string;
			}>;
			expect(foreignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						table: "agent_teams",
						from: "agent_team_id",
						to: "agent_team_id",
						on_delete: "CASCADE",
					}),
					expect.objectContaining({
						table: "agent_team_members",
						from: "agent_team_id",
						to: "agent_team_id",
						on_delete: "CASCADE",
					}),
					expect.objectContaining({
						table: "agent_team_members",
						from: "member_id",
						to: "member_id",
						on_delete: "CASCADE",
					}),
				]),
			);

			db.exec(`
				INSERT INTO agent_teams (
					agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
					leader_member_id, workspace_mode, created_at, updated_at
				) VALUES (
					'team-a', 'leader-machine', '/workspace', 'Team A', 'running',
					'member-a', 'shared', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_members (
					member_id, agent_team_id, role, name, backend_id, lifecycle, health,
					created_at, updated_at
				) VALUES (
					'member-a', 'team-a', 'member', 'Member A', 'backend-a',
					'running', 'healthy', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_member_executions (
					agent_team_id, member_id, execution_machine_id,
					worker_relay_key_id, bootstrap_operation_id, created_at, updated_at
				) VALUES (
					'team-a', 'member-a', 'worker-a', 'relay-a', 'bootstrap-a',
					'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_teams (
					agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
					leader_member_id, workspace_mode, created_at, updated_at
				) VALUES (
					'team-b', 'leader-machine', '/workspace', 'Team B', 'running',
					'member-b', 'shared', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_members (
					member_id, agent_team_id, role, name, backend_id, lifecycle, health,
					created_at, updated_at
				) VALUES (
					'member-b', 'team-b', 'member', 'Member B', 'backend-b',
					'running', 'healthy', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
			`);
			const insertExecution = db.query(`
				INSERT INTO agent_team_member_executions (
					agent_team_id, member_id, execution_machine_id,
					worker_relay_key_id, bootstrap_operation_id, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`);
			expect(() =>
				insertExecution.run(
					"team-a",
					"member-a",
					"worker-b",
					"relay-b",
					"bootstrap-b",
					"2026-01-01T00:00:00.000Z",
					"2026-01-01T00:00:00.000Z",
				),
			).toThrow("UNIQUE constraint failed");
			expect(() =>
				insertExecution.run(
					"team-b",
					"member-b",
					"worker-b",
					"relay-b",
					"bootstrap-a",
					"2026-01-01T00:00:00.000Z",
					"2026-01-01T00:00:00.000Z",
				),
			).toThrow("UNIQUE constraint failed");
			expect(() =>
				insertExecution.run(
					"team-a",
					"member-b",
					"worker-b",
					"relay-b",
					"bootstrap-b",
					"2026-01-01T00:00:00.000Z",
					"2026-01-01T00:00:00.000Z",
				),
			).toThrow("FOREIGN KEY constraint failed");

			db.exec(`
				DELETE FROM agent_team_mcp_status
				WHERE agent_team_id = 'team-a' AND member_id = 'member-a';
				DELETE FROM agent_team_members
				WHERE agent_team_id = 'team-a' AND member_id = 'member-a';
			`);
			const remaining = db
				.query("SELECT COUNT(*) AS count FROM agent_team_member_executions")
				.get() as { count: number };
			expect(remaining.count).toBe(0);
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("upgrades v17 without replacing leader-local Team facts", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-migrate-v17-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);
			db.exec(`
				INSERT INTO agent_teams (
					agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
					leader_member_id, workspace_mode, created_at, updated_at
				) VALUES (
					'team-local', 'leader-machine', '/workspace', 'Local Team', 'running',
					'member-local', 'shared', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_members (
					member_id, agent_team_id, role, name, backend_id, lifecycle, health,
					created_at, updated_at
				) VALUES (
					'member-local', 'team-local', 'leader', 'Leader', 'backend-local',
					'running', 'healthy', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_mailbox_messages (
					message_id, agent_team_id, from_member_id, to_member_id,
					body_local_json, wake_status, created_at
				) VALUES (
					'message-local', 'team-local', 'member-local', 'member-local',
					'{"text":"leader-only"}', 'pending', '2026-01-01T00:00:00.000Z'
				);

				DROP TABLE IF EXISTS team_relay_operations;
				DROP TABLE IF EXISTS remote_team_session_bindings;
				DROP TABLE IF EXISTS agent_team_member_executions;
				DELETE FROM schema_version WHERE version > 17;
			`);

			expect(runMigrations(db)).toBe(17);

			const team = db
				.query(`
					SELECT machine_id, title, leader_member_id
					FROM agent_teams
					WHERE agent_team_id = 'team-local'
				`)
				.get();
			expect(team).toEqual({
				machine_id: "leader-machine",
				title: "Local Team",
				leader_member_id: "member-local",
			});

			const message = db
				.query(`
					SELECT body_local_json
					FROM agent_team_mailbox_messages
					WHERE message_id = 'message-local'
				`)
				.get();
			expect(message).toEqual({ body_local_json: '{"text":"leader-only"}' });

			const relayTables = db
				.query(`
					SELECT name
					FROM sqlite_master
					WHERE type = 'table'
						AND name IN (
							'team_relay_operations',
							'remote_team_session_bindings'
						)
					ORDER BY name
				`)
				.all();
			expect(relayTables).toEqual([
				{ name: "remote_team_session_bindings" },
				{ name: "team_relay_operations" },
			]);

			const schemaVersion = db
				.query("SELECT MAX(version) AS version FROM schema_version")
				.get();
			expect(schemaVersion).toEqual({ version: 21 });
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("upgrades v18 through v21 without replacing leader facts or worker relay rows", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-migrate-v18-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);
			db.exec(`
				INSERT INTO agent_teams (
					agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
					leader_member_id, workspace_mode, created_at, updated_at
				) VALUES (
					'team-local', 'leader-machine', '/workspace', 'Local Team', 'running',
					'member-local', 'shared', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_members (
					member_id, agent_team_id, role, name, backend_id, lifecycle, health,
					created_at, updated_at
				) VALUES (
					'member-local', 'team-local', 'member', 'Member', 'backend-local',
					'running', 'healthy', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_mailbox_messages (
					message_id, agent_team_id, from_member_id, to_member_id,
					body_local_json, wake_status, created_at
				) VALUES (
					'message-local', 'team-local', 'member-local', 'member-local',
					'{"text":"leader-only"}', 'pending', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO team_relay_operations (
					source_machine_id, operation_id, request_digest, status, claim_id,
					claimed_at
				) VALUES (
					'leader-machine', 'relay-operation', 'digest', 'in_progress',
					'claim', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO remote_team_session_bindings (
					server_id, agent_team_id, member_id, leader_machine_id, backend_id,
					lifecycle, created_at, updated_at
				) VALUES (
					'server-worker', 'team-remote', 'member-remote', 'leader-machine',
					'backend-worker', 'creating', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);

				DROP TABLE IF EXISTS agent_team_member_executions;
				DELETE FROM schema_version WHERE version > 18;
			`);

			expect(runMigrations(db)).toBe(18);
			expect(
				db
					.query(
						"SELECT title FROM agent_teams WHERE agent_team_id = 'team-local'",
					)
					.get(),
			).toEqual({ title: "Local Team" });
			expect(
				db
					.query(
						"SELECT body_local_json FROM agent_team_mailbox_messages WHERE message_id = 'message-local'",
					)
					.get(),
			).toEqual({ body_local_json: '{"text":"leader-only"}' });
			expect(
				db
					.query(
						"SELECT status, claim_id FROM team_relay_operations WHERE operation_id = 'relay-operation'",
					)
					.get(),
			).toEqual({ status: "in_progress", claim_id: "claim" });
			expect(
				db
					.query(
						"SELECT server_id, lifecycle FROM remote_team_session_bindings WHERE server_id = 'server-worker'",
					)
					.get(),
			).toEqual({ server_id: "server-worker", lifecycle: "creating" });
			expect(
				db.query("SELECT MAX(version) AS version FROM schema_version").get(),
			).toEqual({ version: 21 });
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("backfills active remote member completions when upgrading from v19", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-migrate-v19-outbox-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);
			db.exec(`
				DROP TRIGGER enqueue_team_runtime_after_turn_end;
				DROP TABLE team_runtime_outbox;
				DELETE FROM schema_version WHERE version > 19;

				INSERT INTO sessions (
					session_id, machine_id, backend_id, current_revision,
					created_at, updated_at
				) VALUES (
					'remote-session', 'worker-machine', 'backend-worker', 1,
					'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO remote_team_session_bindings (
					server_id, agent_team_id, member_id, leader_machine_id,
					backend_id, session_id, lifecycle, created_at, updated_at
				) VALUES (
					'server-worker', 'team-remote', 'member-remote', 'leader-machine',
					'backend-worker', 'remote-session', 'active',
					'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO session_events (
					session_id, revision, seq, kind, payload, created_at
				) VALUES (
					'remote-session', 1, 1, 'turn_end',
					'{"stopReason":"end_turn"}', '2026-01-01T00:00:01.000Z'
				);
			`);

			expect(runMigrations(db)).toBe(19);
			expect(
				db
					.query(`
						SELECT
							source_session_id,
							source_revision,
							source_seq,
							agent_team_id,
							member_id,
							target_machine_id,
							status,
							next_attempt_at
						FROM team_runtime_outbox
					`)
					.all(),
			).toEqual([
				{
					source_session_id: "remote-session",
					source_revision: 1,
					source_seq: 1,
					agent_team_id: "team-remote",
					member_id: "member-remote",
					target_machine_id: "leader-machine",
					status: "pending",
					next_attempt_at: "2026-01-01T00:00:01.000Z",
				},
			]);
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("adds the v21 cleanup index without resurrecting cleared runtime work", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-reopen-v20-outbox-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);
			db.exec(`
				INSERT INTO sessions (
					session_id, machine_id, backend_id, current_revision,
					created_at, updated_at
				) VALUES (
					'remote-session', 'worker-machine', 'backend-worker', 1,
					'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO remote_team_session_bindings (
					server_id, agent_team_id, member_id, leader_machine_id,
					backend_id, session_id, lifecycle, created_at, updated_at
				) VALUES (
					'server-worker', 'team-remote', 'member-remote', 'leader-machine',
					'backend-worker', 'remote-session', 'active',
					'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO session_events (
					session_id, revision, seq, kind, payload, created_at
				) VALUES (
					'remote-session', 1, 1, 'turn_end',
					'{"stopReason":"end_turn"}', '2026-01-01T00:00:01.000Z'
				);
				DELETE FROM team_runtime_outbox;
				DROP INDEX idx_team_runtime_outbox_delivered;
				DELETE FROM schema_version WHERE version = 21;
			`);

			expect(runMigrations(db)).toBe(20);
			expect(db.query("SELECT id FROM team_runtime_outbox").all()).toEqual([]);
			expect(
				db
					.query(`
						SELECT name
						FROM sqlite_master
						WHERE type = 'index'
							AND name = 'idx_team_runtime_outbox_delivered'
					`)
					.get(),
			).toEqual({ name: "idx_team_runtime_outbox_delivered" });
			expect(
				db.query("SELECT MAX(version) AS version FROM schema_version").get(),
			).toEqual({ version: 21 });
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("backfills the capture gap before restoring a missing v20 trigger", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-reconcile-v20-trigger-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);
			db.exec(`
				DROP TRIGGER enqueue_team_runtime_after_turn_end;
				DELETE FROM schema_version WHERE version = 21;
				INSERT INTO sessions (
					session_id, machine_id, backend_id, current_revision,
					created_at, updated_at
				) VALUES (
					'remote-session', 'worker-machine', 'backend-worker', 1,
					'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO remote_team_session_bindings (
					server_id, agent_team_id, member_id, leader_machine_id,
					backend_id, session_id, lifecycle, created_at, updated_at
				) VALUES (
					'server-worker', 'team-remote', 'member-remote', 'leader-machine',
					'backend-worker', 'remote-session', 'active',
					'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
				);
				INSERT INTO session_events (
					session_id, revision, seq, kind, payload, created_at
				) VALUES (
					'remote-session', 1, 1, 'turn_end',
					'{"stopReason":"end_turn"}', '2026-01-01T00:00:01.000Z'
				);
			`);
			expect(db.query("SELECT id FROM team_runtime_outbox").all()).toEqual([]);

			expect(runMigrations(db)).toBe(20);
			expect(
				db
					.query(
						"SELECT source_session_id FROM team_runtime_outbox ORDER BY id",
					)
					.all(),
			).toEqual([{ source_session_id: "remote-session" }]);
			expect(
				db
					.query(`
						SELECT name
						FROM sqlite_master
						WHERE type = 'trigger'
							AND name = 'enqueue_team_runtime_after_turn_end'
					`)
					.get(),
			).toEqual({ name: "enqueue_team_runtime_after_turn_end" });
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("upgrades a v14 database without replacing leader-local Team facts", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-migrate-v14-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			db.exec(`
				CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
				INSERT INTO schema_version (version) VALUES (14);

				CREATE TABLE agent_teams (
					agent_team_id TEXT PRIMARY KEY
				);
				CREATE TABLE agent_team_members (
					member_id TEXT PRIMARY KEY,
					agent_team_id TEXT NOT NULL
				);
				CREATE TABLE agent_team_mailbox_messages (
					message_id TEXT PRIMARY KEY,
					agent_team_id TEXT NOT NULL,
					from_member_id TEXT NOT NULL,
					to_member_id TEXT,
					body_local_json TEXT NOT NULL,
					source_refs_json TEXT,
					read_at TEXT,
					wake_status TEXT NOT NULL,
					created_at TEXT NOT NULL
				);

				INSERT INTO agent_teams (agent_team_id) VALUES ('team-local');
				INSERT INTO agent_team_members (member_id, agent_team_id)
				VALUES ('member-local', 'team-local');
				INSERT INTO agent_team_mailbox_messages (
					message_id, agent_team_id, from_member_id, to_member_id,
					body_local_json, wake_status, created_at
				) VALUES (
					'message-local', 'team-local', 'member-local', 'member-local',
					'{"text":"leader-only"}', 'pending', '2026-01-01T00:00:00.000Z'
				);
			`);

			expect(runMigrations(db)).toBe(14);

			const message = db
				.query(`
					SELECT body_local_json, wake_error_json
					FROM agent_team_mailbox_messages
					WHERE message_id = 'message-local'
				`)
				.get() as {
				body_local_json: string;
				wake_error_json: string | null;
			};
			expect(message).toEqual({
				body_local_json: '{"text":"leader-only"}',
				wake_error_json: null,
			});

			const table = db
				.query(`
					SELECT name
					FROM sqlite_master
					WHERE type = 'table' AND name = 'agent_team_tool_intents'
				`)
				.get();
			expect(table).not.toBeNull();
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("reconciles the former Agent Team v9 schema with mainline migrations", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-migrate-divergent-v9-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		const db = new Database(dbPath);

		try {
			runMigrations(db);
			db.exec(`
				INSERT INTO agent_teams (
					agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
					leader_member_id, workspace_mode, created_at, updated_at
				) VALUES (
					'team-local', 'leader-machine', '/workspace', 'Local Team', 'running',
					'member-local', 'shared', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_members (
					member_id, agent_team_id, role, name, backend_id, lifecycle, health,
					created_at, updated_at
				) VALUES (
					'member-local', 'team-local', 'leader', 'Leader', 'backend-local',
					'running', 'healthy', '2026-01-01T00:00:00.000Z',
					'2026-01-01T00:00:00.000Z'
				);
				INSERT INTO agent_team_mailbox_messages (
					message_id, agent_team_id, from_member_id, to_member_id,
					body_local_json, wake_status, created_at
				) VALUES (
					'message-local', 'team-local', 'member-local', 'member-local',
					'{"text":"leader-only"}', 'pending', '2026-01-01T00:00:00.000Z'
				);

				ALTER TABLE sessions DROP COLUMN additional_directories_json;
				ALTER TABLE discovered_sessions DROP COLUMN additional_directories_json;
				ALTER TABLE discovered_sessions DROP COLUMN meta_json;
				DROP TABLE message_send_results;
				DROP TABLE session_revision_keys;
				DROP TABLE message_send_claims;
				DROP TABLE wal_encryption_identity;
				DELETE FROM schema_version WHERE version > 9;
			`);

			expect(runMigrations(db)).toBe(9);

			const tables = db
				.query("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all() as Array<{ name: string }>;
			const tableNames = tables.map(({ name }) => name);
			expect(tableNames).toContain("message_send_results");
			expect(tableNames).toContain("session_revision_keys");
			expect(tableNames).toContain("message_send_claims");
			expect(tableNames).toContain("wal_encryption_identity");
			expect(tableNames).toContain("agent_team_tool_intents");

			const resultColumns = db
				.query("PRAGMA table_info(message_send_results)")
				.all() as Array<{ name: string }>;
			expect(resultColumns.map(({ name }) => name)).toContain("usage_json");

			const message = db
				.query(`
					SELECT body_local_json, wake_error_json
					FROM agent_team_mailbox_messages
					WHERE message_id = 'message-local'
				`)
				.get() as {
				body_local_json: string;
				wake_error_json: string | null;
			};
			expect(message).toEqual({
				body_local_json: '{"text":"leader-only"}',
				wake_error_json: null,
			});

			const schemaVersion = db
				.query("SELECT MAX(version) AS version FROM schema_version")
				.get() as { version: number };
			expect(schemaVersion.version).toBe(21);
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("restores the complete message result schema for a divergent v14 database", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-team-migrate-divergent-v14-"),
		);
		const dbPath = path.join(tempDir, "events.db");
		let db: Database | undefined = new Database(dbPath);

		try {
			runMigrations(db);
			db.exec(`
				DROP TABLE message_send_results;
				DELETE FROM schema_version WHERE version > 14;
			`);

			expect(runMigrations(db)).toBe(14);
			const columns = db
				.query("PRAGMA table_info(message_send_results)")
				.all() as Array<{ name: string }>;
			expect(columns.map(({ name }) => name)).toContain("usage_json");
			db.close();
			db = undefined;

			const walStore = new WalStore(dbPath);
			walStore.close();
		} finally {
			db?.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
