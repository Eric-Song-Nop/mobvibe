import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../wal/migrations.js";
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
		} finally {
			db.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
