import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
	AgentTeamLifecycle,
	AgentTeamSummary,
	CreateAgentTeamRpcParams,
	CreateAgentTeamRpcResult,
	GetAgentTeamRpcParams,
	GetAgentTeamRpcResult,
	ListAgentTeamsRpcParams,
	ListAgentTeamsRpcResult,
	TeamMailboxCounts,
	TeamMemberHealth,
	TeamMemberLifecycle,
	TeamMemberSummary,
	TeamMcpStatusSummary,
	TeamTaskCounts,
	TeamWorkspaceMode,
} from "@mobvibe/shared";
import { runMigrations } from "../wal/migrations.js";

const emptyMailboxCounts = (): TeamMailboxCounts => ({
	unread: 0,
	wakePending: 0,
	wakeFailed: 0,
});

const emptyTaskCounts = (): TeamTaskCounts => ({
	todo: 0,
	inProgress: 0,
	blocked: 0,
	completed: 0,
	failed: 0,
	cancelled: 0,
});

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
		return { teams: filtered.map((row) => this.rowToSummary(row)) };
	}

	getAgentTeam(params: GetAgentTeamRpcParams): GetAgentTeamRpcResult {
		const row = this.stmtGetTeam.get({
			$agentTeamId: params.agentTeamId,
		}) as AgentTeamRow | null;
		if (!row || (params.machineId && row.machine_id !== params.machineId)) {
			return {};
		}
		return { team: this.rowToSummary(row) };
	}

	close(): void {
		this.db.close();
	}

	private rowToSummary(row: AgentTeamRow): AgentTeamSummary {
		const members = this.memberRows(row.agent_team_id);
		return {
			agentTeamId: row.agent_team_id,
			machineId: row.machine_id,
			title: row.title,
			workspaceRootCwd: row.workspace_root_cwd,
			workspaceMode: row.workspace_mode as TeamWorkspaceMode,
			leaderMemberId: row.leader_member_id,
			lifecycle: row.lifecycle as AgentTeamLifecycle,
			members,
			mailboxCounts: emptyMailboxCounts(),
			taskCounts: emptyTaskCounts(),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			archivedAt: row.archived_at ?? undefined,
		};
	}

	private memberRows(agentTeamId: string): TeamMemberSummary[] {
		const rows = this.stmtListMembers.all({
			$agentTeamId: agentTeamId,
		}) as AgentTeamMemberRow[];
		const mcpByMemberId = new Map(
			(
				this.stmtListMcpStatuses.all({
					$agentTeamId: agentTeamId,
				}) as AgentTeamMcpStatusRow[]
			).map((row) => [row.member_id, row]),
		);

		return rows.map((row) => ({
			memberId: row.member_id,
			agentTeamId: row.agent_team_id,
			role: row.role as "leader" | "member",
			name: row.name,
			backendId: row.backend_id,
			sessionId: row.session_id ?? undefined,
			lifecycle: row.lifecycle as TeamMemberLifecycle,
			health: row.health as TeamMemberHealth,
			mcp: this.rowToMcpStatus(mcpByMemberId.get(row.member_id)),
			mailboxCounts: emptyMailboxCounts(),
			taskCounts: emptyTaskCounts(),
			pendingPermissionCount: 0,
			worktreeSourceCwd: row.worktree_source_cwd ?? undefined,
			worktreeBranch: row.worktree_branch ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	private rowToMcpStatus(
		row: AgentTeamMcpStatusRow | undefined,
	): TeamMcpStatusSummary | undefined {
		if (!row) return undefined;
		return {
			transport: row.transport as TeamMcpStatusSummary["transport"],
			phase: row.phase as TeamMcpStatusSummary["phase"],
			serverId: row.server_id ?? undefined,
			updatedAt: row.updated_at,
		};
	}
}

type AgentTeamRow = {
	agent_team_id: string;
	machine_id: string;
	workspace_root_cwd: string;
	title: string;
	lifecycle: string;
	leader_member_id: string;
	workspace_mode: string;
	created_at: string;
	updated_at: string;
	archived_at: string | null;
};

type AgentTeamMemberRow = {
	member_id: string;
	agent_team_id: string;
	role: string;
	name: string;
	backend_id: string;
	session_id: string | null;
	lifecycle: string;
	health: string;
	worktree_source_cwd: string | null;
	worktree_branch: string | null;
	created_at: string;
	updated_at: string;
};

type AgentTeamMcpStatusRow = {
	agent_team_id: string;
	member_id: string;
	transport: string;
	server_id: string | null;
	phase: string;
	updated_at: string;
};
