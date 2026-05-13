import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
	CreateAgentTeamRpcParams,
	CreateAgentTeamRpcResult,
	GetAgentTeamRpcParams,
	GetAgentTeamRpcResult,
	ListAgentTeamsRpcParams,
	ListAgentTeamsRpcResult,
} from "@mobvibe/shared";
import { runMigrations } from "../wal/migrations.js";
import { assertGatewayFacingAgentTeamPayload } from "./content-boundary.js";
import {
	type AgentTeamMailboxMessageRow,
	type AgentTeamMcpStatusRow,
	type AgentTeamMemberRow,
	type AgentTeamRow,
	type AgentTeamSummaryRefRow,
	type AgentTeamTaskRow,
	buildAgentTeamSummary,
} from "./projection-builder.js";

export class AgentTeamStore {
	private db: Database;
	private stmtInsertTeam: ReturnType<Database["query"]>;
	private stmtInsertMember: ReturnType<Database["query"]>;
	private stmtInsertMcpStatus: ReturnType<Database["query"]>;
	private stmtGetTeam: ReturnType<Database["query"]>;
	private stmtListTeams: ReturnType<Database["query"]>;
	private stmtListActiveTeams: ReturnType<Database["query"]>;
	private stmtListMembers: ReturnType<Database["query"]>;
	private stmtListMcpStatuses: ReturnType<Database["query"]>;
	private stmtListMailboxMessages: ReturnType<Database["query"]>;
	private stmtListTasks: ReturnType<Database["query"]>;
	private stmtListSummaryRefs: ReturnType<Database["query"]>;

	constructor(dbPath: string) {
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(dbPath);
		runMigrations(this.db);

		this.stmtInsertTeam = this.db.query(`
      INSERT INTO agent_teams (
        agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
        leader_member_id, workspace_mode, created_at, updated_at, archived_at
      ) VALUES (
        $agentTeamId, $machineId, $workspaceRootCwd, $title, $lifecycle,
        $leaderMemberId, $workspaceMode, $createdAt, $updatedAt, $archivedAt
      )
    `);
		this.stmtInsertMember = this.db.query(`
      INSERT INTO agent_team_members (
        member_id, agent_team_id, role, name, backend_id, session_id, lifecycle,
        health, worktree_source_cwd, worktree_branch, error_json, created_at, updated_at
      ) VALUES (
        $memberId, $agentTeamId, $role, $name, $backendId, $sessionId, $lifecycle,
        $health, $worktreeSourceCwd, $worktreeBranch, $errorJson, $createdAt, $updatedAt
      )
    `);
		this.stmtInsertMcpStatus = this.db.query(`
      INSERT INTO agent_team_mcp_status (
        agent_team_id, member_id, transport, server_id, phase, last_error_json, updated_at
      ) VALUES (
        $agentTeamId, $memberId, $transport, $serverId, $phase, $lastErrorJson, $updatedAt
      )
    `);
		this.stmtGetTeam = this.db.query(`
      SELECT * FROM agent_teams WHERE agent_team_id = $agentTeamId
    `);
		this.stmtListTeams = this.db.query(`
      SELECT * FROM agent_teams ORDER BY updated_at DESC
    `);
		this.stmtListActiveTeams = this.db.query(`
      SELECT * FROM agent_teams WHERE archived_at IS NULL ORDER BY updated_at DESC
    `);
		this.stmtListMembers = this.db.query(`
      SELECT * FROM agent_team_members WHERE agent_team_id = $agentTeamId ORDER BY created_at ASC
    `);
		this.stmtListMcpStatuses = this.db.query(`
      SELECT * FROM agent_team_mcp_status WHERE agent_team_id = $agentTeamId
    `);
		this.stmtListMailboxMessages = this.db.query(`
      SELECT message_id, agent_team_id, from_member_id, to_member_id, source_refs_json,
             read_at, wake_status, created_at
      FROM agent_team_mailbox_messages
      WHERE agent_team_id = $agentTeamId
      ORDER BY created_at ASC
    `);
		this.stmtListTasks = this.db.query(`
      SELECT task_id, agent_team_id, owner_member_id, status, source_refs_json, created_at, updated_at
      FROM agent_team_tasks
      WHERE agent_team_id = $agentTeamId
      ORDER BY updated_at ASC
    `);
		this.stmtListSummaryRefs = this.db.query(`
      SELECT summary_ref_id, agent_team_id, source_refs_json, status, created_at, updated_at
      FROM agent_team_summary_refs
      WHERE agent_team_id = $agentTeamId
      ORDER BY updated_at ASC
    `);
	}

	createAgentTeam(params: CreateAgentTeamRpcParams): CreateAgentTeamRpcResult {
		const now = new Date().toISOString();
		const agentTeamId = randomUUID();
		const leaderMemberId = randomUUID();
		const title = params.title?.trim() || "Agent Team";
		const workspaceMode = params.workspaceMode ?? "shared_workspace";

		this.db.transaction(() => {
			this.stmtInsertTeam.run({
				$agentTeamId: agentTeamId,
				$machineId: params.machineId,
				$workspaceRootCwd: params.workspaceRootCwd,
				$title: title,
				$lifecycle: "pending",
				$leaderMemberId: leaderMemberId,
				$workspaceMode: workspaceMode,
				$createdAt: now,
				$updatedAt: now,
				$archivedAt: null,
			});
			this.stmtInsertMember.run({
				$memberId: leaderMemberId,
				$agentTeamId: agentTeamId,
				$role: "leader",
				$name: params.leaderName?.trim() || "Leader",
				$backendId: params.backendId,
				$sessionId: null,
				$lifecycle: "pending",
				$health: "healthy",
				$worktreeSourceCwd: null,
				$worktreeBranch: null,
				$errorJson: null,
				$createdAt: now,
				$updatedAt: now,
			});
			this.stmtInsertMcpStatus.run({
				$agentTeamId: agentTeamId,
				$memberId: leaderMemberId,
				$transport: "acp",
				$serverId: null,
				$phase: "not_started",
				$lastErrorJson: null,
				$updatedAt: now,
			});
		})();

		const team = this.getAgentTeam({ agentTeamId }).team;
		if (!team) {
			throw new Error(`Agent Team was not created: ${agentTeamId}`);
		}
		return { team };
	}

	listAgentTeams(
		params: ListAgentTeamsRpcParams = {},
	): ListAgentTeamsRpcResult {
		const rows = (
			params.includeArchived
				? this.stmtListTeams.all()
				: this.stmtListActiveTeams.all()
		) as AgentTeamRow[];
		const filtered = params.machineId
			? rows.filter((row) => row.machine_id === params.machineId)
			: rows;
		return { teams: filtered.map((row) => this.projectTeam(row)) };
	}

	getAgentTeam(params: GetAgentTeamRpcParams): GetAgentTeamRpcResult {
		const row = this.stmtGetTeam.get({
			$agentTeamId: params.agentTeamId,
		}) as AgentTeamRow | null;
		if (!row || (params.machineId && row.machine_id !== params.machineId)) {
			return {};
		}
		return { team: this.projectTeam(row) };
	}

	close(): void {
		this.db.close();
	}

	private projectTeam(row: AgentTeamRow) {
		const agentTeamId = row.agent_team_id;
		const team = buildAgentTeamSummary({
			team: row,
			members: this.stmtListMembers.all({
				$agentTeamId: agentTeamId,
			}) as AgentTeamMemberRow[],
			mcpStatuses: this.stmtListMcpStatuses.all({
				$agentTeamId: agentTeamId,
			}) as AgentTeamMcpStatusRow[],
			mailboxMessages: this.stmtListMailboxMessages.all({
				$agentTeamId: agentTeamId,
			}) as AgentTeamMailboxMessageRow[],
			tasks: this.stmtListTasks.all({
				$agentTeamId: agentTeamId,
			}) as AgentTeamTaskRow[],
			summaryRefs: this.stmtListSummaryRefs.all({
				$agentTeamId: agentTeamId,
			}) as AgentTeamSummaryRefRow[],
		});
		assertGatewayFacingAgentTeamPayload(team);
		return team;
	}
}
