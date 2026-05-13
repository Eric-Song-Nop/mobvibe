import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../wal/migrations.js";
import { AgentTeamStore } from "../agent-team-store.js";

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
});

describe("Agent Team migrations", () => {
	test("run from an empty database and preserve existing WAL session tables", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-migrate-"));
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
