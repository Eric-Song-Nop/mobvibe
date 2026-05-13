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
	TeamMailboxWakeStatus,
	TeamMcpPhase,
	TeamMcpTransport,
	TeamSourceRef,
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
	private stmtUpdateMemberRuntimeState: ReturnType<Database["query"]>;
	private stmtGetTeam: ReturnType<Database["query"]>;
	private stmtListTeams: ReturnType<Database["query"]>;
	private stmtListActiveTeams: ReturnType<Database["query"]>;
	private stmtListMembers: ReturnType<Database["query"]>;
	private stmtListMcpStatuses: ReturnType<Database["query"]>;
	private stmtListMailboxMessages: ReturnType<Database["query"]>;
	private stmtListTasks: ReturnType<Database["query"]>;
	private stmtListLocalTasks: ReturnType<Database["query"]>;
	private stmtListSummaryRefs: ReturnType<Database["query"]>;
	private stmtInsertMailboxMessage: ReturnType<Database["query"]>;
	private stmtUpdateMailboxWake: ReturnType<Database["query"]>;
	private stmtReadUnreadMailboxMessages: ReturnType<Database["query"]>;
	private stmtGetMailboxMessage: ReturnType<Database["query"]>;
	private stmtUpdateMailboxWakeMetadata: ReturnType<Database["query"]>;
	private stmtTouchTeam: ReturnType<Database["query"]>;
	private stmtUpdateMcpStatus: ReturnType<Database["query"]>;
	private stmtInsertToolIntent: ReturnType<Database["query"]>;
	private stmtInsertTask: ReturnType<Database["query"]>;
	private stmtGetTask: ReturnType<Database["query"]>;
	private stmtUpdateTask: ReturnType<Database["query"]>;

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
		this.stmtUpdateMemberRuntimeState = this.db.query(`
      UPDATE agent_team_members
      SET session_id = COALESCE($sessionId, session_id),
          lifecycle = COALESCE($lifecycle, lifecycle),
          updated_at = $updatedAt
      WHERE member_id = $memberId
        AND agent_team_id = $agentTeamId
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
      SELECT task_id, agent_team_id, owner_member_id, status, source_refs_json,
             blocked_by_json, blocks_json, created_at, updated_at
      FROM agent_team_tasks
      WHERE agent_team_id = $agentTeamId
      ORDER BY updated_at ASC
    `);
		this.stmtListLocalTasks = this.db.query(`
      SELECT task_id, agent_team_id, owner_member_id, status, body_local_json,
             blocked_by_json, blocks_json, source_refs_json, created_at, updated_at
      FROM agent_team_tasks
      WHERE agent_team_id = $agentTeamId
      ORDER BY created_at ASC
    `);
		this.stmtListSummaryRefs = this.db.query(`
      SELECT summary_ref_id, agent_team_id, source_refs_json, status, created_at, updated_at
      FROM agent_team_summary_refs
      WHERE agent_team_id = $agentTeamId
      ORDER BY updated_at ASC
    `);
		this.stmtInsertMailboxMessage = this.db.query(`
      INSERT INTO agent_team_mailbox_messages (
        message_id, agent_team_id, from_member_id, to_member_id, body_local_json,
        source_refs_json, read_at, wake_status, wake_error_json, created_at
      ) VALUES (
        $messageId, $agentTeamId, $fromMemberId, $toMemberId, $bodyLocalJson,
        $sourceRefsJson, $readAt, $wakeStatus, $wakeErrorJson, $createdAt
      )
    `);
		this.stmtUpdateMailboxWake = this.db.query(`
      UPDATE agent_team_mailbox_messages
      SET wake_status = $wakeStatus
      WHERE message_id = $messageId
    `);
		this.stmtReadUnreadMailboxMessages = this.db.query(`
      SELECT message_id, agent_team_id, from_member_id, to_member_id, body_local_json,
             source_refs_json, read_at, wake_status, wake_error_json, created_at
      FROM agent_team_mailbox_messages
      WHERE agent_team_id = $agentTeamId
        AND to_member_id = $memberId
        AND read_at IS NULL
      ORDER BY created_at ASC
    `);
		this.stmtGetMailboxMessage = this.db.query(`
      SELECT message_id, agent_team_id, from_member_id, to_member_id, body_local_json,
             source_refs_json, read_at, wake_status, wake_error_json, created_at
      FROM agent_team_mailbox_messages
      WHERE message_id = $messageId
    `);
		this.stmtUpdateMailboxWakeMetadata = this.db.query(`
      UPDATE agent_team_mailbox_messages
      SET wake_status = $wakeStatus,
          wake_error_json = $wakeErrorJson,
          source_refs_json = $sourceRefsJson
      WHERE message_id = $messageId
    `);
		this.stmtTouchTeam = this.db.query(`
      UPDATE agent_teams
      SET updated_at = $updatedAt
      WHERE agent_team_id = $agentTeamId
    `);
		this.stmtUpdateMcpStatus = this.db.query(`
      INSERT INTO agent_team_mcp_status (
        agent_team_id, member_id, transport, server_id, phase, last_error_json, updated_at
      ) VALUES (
        $agentTeamId, $memberId, $transport, $serverId, $phase, $lastErrorJson, $updatedAt
      )
      ON CONFLICT(agent_team_id, member_id) DO UPDATE SET
        transport = excluded.transport,
        server_id = excluded.server_id,
        phase = excluded.phase,
        last_error_json = excluded.last_error_json,
        updated_at = excluded.updated_at
    `);
		this.stmtInsertToolIntent = this.db.query(`
      INSERT INTO agent_team_tool_intents (
        intent_id, agent_team_id, requested_by_member_id, kind, payload_local_json,
        status, source_refs_json, created_at, updated_at
      ) VALUES (
        $intentId, $agentTeamId, $requestedByMemberId, $kind, $payloadLocalJson,
        $status, $sourceRefsJson, $createdAt, $updatedAt
      )
    `);
		this.stmtInsertTask = this.db.query(`
      INSERT INTO agent_team_tasks (
        task_id, agent_team_id, owner_member_id, status, body_local_json,
        blocked_by_json, blocks_json, source_refs_json, created_at, updated_at
      ) VALUES (
        $taskId, $agentTeamId, $ownerMemberId, $status, $bodyLocalJson,
        $blockedByJson, $blocksJson, $sourceRefsJson, $createdAt, $updatedAt
      )
    `);
		this.stmtGetTask = this.db.query(`
      SELECT task_id, agent_team_id, owner_member_id, status, body_local_json,
             blocked_by_json, blocks_json, source_refs_json, created_at, updated_at
      FROM agent_team_tasks
      WHERE agent_team_id = $agentTeamId AND task_id = $taskId
    `);
		this.stmtUpdateTask = this.db.query(`
      UPDATE agent_team_tasks
      SET owner_member_id = $ownerMemberId,
          status = $status,
          body_local_json = $bodyLocalJson,
          blocked_by_json = $blockedByJson,
	          blocks_json = $blocksJson,
          source_refs_json = $sourceRefsJson,
          updated_at = $updatedAt
      WHERE agent_team_id = $agentTeamId AND task_id = $taskId
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

	addTeamMember(params: {
		agentTeamId: string;
		backendId: string;
		name: string;
		role?: "leader" | "member";
	}): { memberId: string } {
		const now = new Date().toISOString();
		const memberId = randomUUID();
		this.db.transaction(() => {
			this.stmtInsertMember.run({
				$memberId: memberId,
				$agentTeamId: params.agentTeamId,
				$role: params.role ?? "member",
				$name: params.name,
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
				$agentTeamId: params.agentTeamId,
				$memberId: memberId,
				$transport: "acp",
				$serverId: null,
				$phase: "not_started",
				$lastErrorJson: null,
				$updatedAt: now,
			});
		})();
		return { memberId };
	}

	listTeamMembers(agentTeamId: string): AgentTeamMemberRow[] {
		return this.stmtListMembers.all({
			$agentTeamId: agentTeamId,
		}) as AgentTeamMemberRow[];
	}

	listLocalTasks(agentTeamId: string): AgentTeamTaskLocalRow[] {
		return this.stmtListLocalTasks.all({
			$agentTeamId: agentTeamId,
		}) as AgentTeamTaskLocalRow[];
	}

	createTeamTask(params: {
		agentTeamId: string;
		ownerMemberId: string | null;
		status: string;
		body: TeamTaskLocalBody;
		blockedBy: string[];
	}): AgentTeamTaskLocalRow {
		const now = new Date().toISOString();
		const taskId = randomUUID();
		const sourceRefs: TeamSourceRef[] = [
			{
				type: "task",
				agentTeamId: params.agentTeamId,
				taskId,
				ownerMemberId: params.ownerMemberId ?? undefined,
			},
		];

		return this.db.transaction(() => {
			const existingTasks = this.listLocalTasks(params.agentTeamId);
			assertTaskIdsExist(existingTasks, params.blockedBy);
			this.stmtInsertTask.run({
				$taskId: taskId,
				$agentTeamId: params.agentTeamId,
				$ownerMemberId: params.ownerMemberId,
				$status: params.status,
				$bodyLocalJson: JSON.stringify(params.body),
				$blockedByJson: JSON.stringify(params.blockedBy),
				$blocksJson: JSON.stringify([]),
				$sourceRefsJson: JSON.stringify(sourceRefs),
				$createdAt: now,
				$updatedAt: now,
			});
			for (const upstreamId of params.blockedBy) {
				const upstream = this.getLocalTask(params.agentTeamId, upstreamId);
				if (!upstream) continue;
				const blocks = appendUnique(
					parseJsonStringArray(upstream.blocks_json),
					taskId,
				);
				this.updateTaskRow(upstream, { blocks, updatedAt: now });
			}
			this.touchTeam(params.agentTeamId, now);
			return requireTask(this.getLocalTask(params.agentTeamId, taskId), taskId);
		})();
	}

	updateTeamTask(params: {
		agentTeamId: string;
		taskId: string;
		ownerMemberId?: string | null;
		status?: string;
		body?: Partial<TeamTaskLocalBody>;
		blockedBy?: string[];
	}): AgentTeamTaskLocalRow {
		const now = new Date().toISOString();
		return this.db.transaction(() => {
			const current = requireTask(
				this.getLocalTask(params.agentTeamId, params.taskId),
				params.taskId,
			);
			const body = {
				...parseTaskBody(current.body_local_json),
				...params.body,
			};
			const oldBlockedBy = parseJsonStringArray(current.blocked_by_json);
			const nextBlockedBy = params.blockedBy ?? oldBlockedBy;
			assertTaskIdsExist(
				this.listLocalTasks(params.agentTeamId),
				nextBlockedBy,
			);
			let nextStatus = params.status ?? current.status;
			if (!params.status && nextBlockedBy.length > 0) nextStatus = "blocked";
			if (
				!params.status &&
				nextBlockedBy.length === 0 &&
				current.status === "blocked"
			) {
				nextStatus = "todo";
			}

			let nextBlocks = parseJsonStringArray(current.blocks_json);
			this.reconcileDependencyEdges({
				agentTeamId: params.agentTeamId,
				taskId: params.taskId,
				oldBlockedBy,
				nextBlockedBy,
				now,
			});
			if (nextStatus === "completed") {
				this.unblockDependents(params.agentTeamId, params.taskId, now);
				nextBlocks = [];
			}

			this.updateTaskRow(current, {
				ownerMemberId:
					params.ownerMemberId === undefined
						? current.owner_member_id
						: params.ownerMemberId,
				status: nextStatus,
				body,
				blockedBy: nextBlockedBy,
				blocks: nextBlocks,
				updatedAt: now,
			});
			this.touchTeam(params.agentTeamId, now);
			return requireTask(
				this.getLocalTask(params.agentTeamId, params.taskId),
				params.taskId,
			);
		})();
	}

	createMailboxMessages(params: {
		agentTeamId: string;
		fromMemberId: string;
		recipients: Array<{ memberId: string; name: string }>;
		body: { message: string; summary?: string; type?: string };
	}): Array<{
		messageId: string;
		fromMemberId: string;
		toMemberId: string;
		toName: string;
		wakeStatus: "pending";
		sourceRefs: TeamSourceRef[];
	}> {
		const now = new Date().toISOString();
		const deliveries = params.recipients.map((recipient) => {
			const messageId = randomUUID();
			const sourceRefs: TeamSourceRef[] = [
				{
					type: "mailbox_message",
					agentTeamId: params.agentTeamId,
					messageId,
					fromMemberId: params.fromMemberId,
					toMemberId: recipient.memberId,
				},
			];
			return {
				messageId,
				fromMemberId: params.fromMemberId,
				toMemberId: recipient.memberId,
				toName: recipient.name,
				wakeStatus: "pending" as const,
				sourceRefs,
			};
		});

		this.db.transaction(() => {
			for (const delivery of deliveries) {
				this.stmtInsertMailboxMessage.run({
					$messageId: delivery.messageId,
					$agentTeamId: params.agentTeamId,
					$fromMemberId: params.fromMemberId,
					$toMemberId: delivery.toMemberId,
					$bodyLocalJson: JSON.stringify(params.body),
					$sourceRefsJson: JSON.stringify(delivery.sourceRefs),
					$readAt: null,
					$wakeStatus: delivery.wakeStatus,
					$wakeErrorJson: null,
					$createdAt: now,
				});
			}
			this.stmtTouchTeam.run({
				$agentTeamId: params.agentTeamId,
				$updatedAt: now,
			});
		})();

		return deliveries;
	}

	updateMailboxWake(params: {
		messageId: string;
		wakeStatus: TeamMailboxWakeStatus;
	}): void {
		this.stmtUpdateMailboxWake.run({
			$messageId: params.messageId,
			$wakeStatus: params.wakeStatus,
		});
	}

	updateTeamMemberRuntimeState(params: {
		agentTeamId: string;
		memberId: string;
		sessionId?: string;
		lifecycle?: string;
	}): void {
		this.stmtUpdateMemberRuntimeState.run({
			$agentTeamId: params.agentTeamId,
			$memberId: params.memberId,
			$sessionId: params.sessionId ?? null,
			$lifecycle: params.lifecycle ?? null,
			$updatedAt: new Date().toISOString(),
		});
	}

	readUnreadAndMark(
		agentTeamId: string,
		memberId: string,
	): MailboxWakeMessage[] {
		const readAt = new Date().toISOString();
		return this.db.transaction(() => {
			const rows = this.stmtReadUnreadMailboxMessages.all({
				$agentTeamId: agentTeamId,
				$memberId: memberId,
			}) as AgentTeamMailboxMessageLocalRow[];
			if (rows.length === 0) {
				return [];
			}
			const placeholders = rows.map(() => "?").join(", ");
			this.db
				.query(
					`UPDATE agent_team_mailbox_messages SET read_at = ? WHERE message_id IN (${placeholders})`,
				)
				.run(readAt, ...rows.map((row) => row.message_id));
			return rows.map(rowToWakeMessage);
		})();
	}

	updateWakeMetadata(params: {
		messageId: string;
		wakeStatus: "sent" | "failed";
		deliveredSessionId?: string;
		error?: { code: string; message: string };
		sourceRefs?: TeamSourceRef[];
	}): void {
		this.db.transaction(() => {
			const row = this.stmtGetMailboxMessage.get({
				$messageId: params.messageId,
			}) as AgentTeamMailboxMessageLocalRow | null;
			if (!row) {
				throw new Error(`Mailbox message not found: ${params.messageId}`);
			}
			const existingRefs = parseSourceRefs(row.source_refs_json);
			const updatedRefs = mergeSourceRefs(
				existingRefs.map((ref) =>
					ref.type === "mailbox_message" && ref.messageId === params.messageId
						? {
								...ref,
								deliveredSessionId:
									params.deliveredSessionId ?? ref.deliveredSessionId,
							}
						: ref,
				),
				params.sourceRefs ?? [],
			);
			this.stmtUpdateMailboxWakeMetadata.run({
				$messageId: params.messageId,
				$wakeStatus: params.wakeStatus,
				$wakeErrorJson: params.error ? JSON.stringify(params.error) : null,
				$sourceRefsJson: JSON.stringify(updatedRefs),
			});
			this.stmtTouchTeam.run({
				$agentTeamId: row.agent_team_id,
				$updatedAt: new Date().toISOString(),
			});
		})();
	}

	updateMcpStatus(params: {
		agentTeamId: string;
		memberId: string;
		transport: TeamMcpTransport;
		serverId?: string;
		phase: TeamMcpPhase;
		lastError?: unknown;
	}): void {
		this.stmtUpdateMcpStatus.run({
			$agentTeamId: params.agentTeamId,
			$memberId: params.memberId,
			$transport: params.transport,
			$serverId: params.serverId ?? null,
			$phase: params.phase,
			$lastErrorJson: params.lastError
				? JSON.stringify(params.lastError)
				: null,
			$updatedAt: new Date().toISOString(),
		});
	}

	createTeamToolIntent(params: {
		agentTeamId: string;
		requestedByMemberId: string;
		kind: TeamToolIntentKind;
		payload: Record<string, unknown>;
		sourceRefs: TeamSourceRef[];
	}): TeamToolIntent {
		const now = new Date().toISOString();
		const intent: TeamToolIntent = {
			intentId: randomUUID(),
			agentTeamId: params.agentTeamId,
			requestedByMemberId: params.requestedByMemberId,
			kind: params.kind,
			payload: params.payload,
			status: "requested",
			sourceRefs: params.sourceRefs,
			createdAt: now,
			updatedAt: now,
		};
		this.stmtInsertToolIntent.run({
			$intentId: intent.intentId,
			$agentTeamId: intent.agentTeamId,
			$requestedByMemberId: intent.requestedByMemberId,
			$kind: intent.kind,
			$payloadLocalJson: JSON.stringify(intent.payload),
			$status: intent.status,
			$sourceRefsJson: JSON.stringify(intent.sourceRefs),
			$createdAt: intent.createdAt,
			$updatedAt: intent.updatedAt,
		});
		return intent;
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

	private getLocalTask(
		agentTeamId: string,
		taskId: string,
	): AgentTeamTaskLocalRow | null {
		return this.stmtGetTask.get({
			$agentTeamId: agentTeamId,
			$taskId: taskId,
		}) as AgentTeamTaskLocalRow | null;
	}

	private updateTaskRow(
		row: AgentTeamTaskLocalRow,
		updates: {
			ownerMemberId?: string | null;
			status?: string;
			body?: TeamTaskLocalBody;
			blockedBy?: string[];
			blocks?: string[];
			updatedAt: string;
		},
	): void {
		this.stmtUpdateTask.run({
			$taskId: row.task_id,
			$agentTeamId: row.agent_team_id,
			$ownerMemberId: updates.ownerMemberId ?? row.owner_member_id,
			$status: updates.status ?? row.status,
			$bodyLocalJson: JSON.stringify(
				updates.body ?? parseTaskBody(row.body_local_json),
			),
			$blockedByJson: JSON.stringify(
				updates.blockedBy ?? parseJsonStringArray(row.blocked_by_json),
			),
			$blocksJson: JSON.stringify(
				updates.blocks ?? parseJsonStringArray(row.blocks_json),
			),
			$sourceRefsJson: row.source_refs_json,
			$updatedAt: updates.updatedAt,
		});
	}

	private reconcileDependencyEdges(params: {
		agentTeamId: string;
		taskId: string;
		oldBlockedBy: string[];
		nextBlockedBy: string[];
		now: string;
	}): void {
		for (const upstreamId of params.oldBlockedBy) {
			if (params.nextBlockedBy.includes(upstreamId)) continue;
			const upstream = this.getLocalTask(params.agentTeamId, upstreamId);
			if (!upstream) continue;
			this.updateTaskRow(upstream, {
				blocks: parseJsonStringArray(upstream.blocks_json).filter(
					(id) => id !== params.taskId,
				),
				updatedAt: params.now,
			});
		}
		for (const upstreamId of params.nextBlockedBy) {
			if (params.oldBlockedBy.includes(upstreamId)) continue;
			const upstream = this.getLocalTask(params.agentTeamId, upstreamId);
			if (!upstream) continue;
			this.updateTaskRow(upstream, {
				blocks: appendUnique(
					parseJsonStringArray(upstream.blocks_json),
					params.taskId,
				),
				updatedAt: params.now,
			});
		}
	}

	private unblockDependents(
		agentTeamId: string,
		completedTaskId: string,
		now: string,
	): void {
		for (const task of this.listLocalTasks(agentTeamId)) {
			const blockedBy = parseJsonStringArray(task.blocked_by_json);
			if (!blockedBy.includes(completedTaskId)) continue;
			const nextBlockedBy = blockedBy.filter((id) => id !== completedTaskId);
			const canAutoTodo = !["completed", "failed", "cancelled"].includes(
				task.status,
			);
			this.updateTaskRow(task, {
				blockedBy: nextBlockedBy,
				status:
					nextBlockedBy.length === 0 && canAutoTodo ? "todo" : task.status,
				updatedAt: now,
			});
		}
	}

	private touchTeam(agentTeamId: string, updatedAt: string): void {
		this.stmtTouchTeam.run({
			$agentTeamId: agentTeamId,
			$updatedAt: updatedAt,
		});
	}
}

export type TeamToolIntentKind =
	| "spawn_member"
	| "rename_team"
	| "shutdown_team";

export type TeamToolIntent = {
	intentId: string;
	agentTeamId: string;
	requestedByMemberId: string;
	kind: TeamToolIntentKind;
	payload: Record<string, unknown>;
	status: "requested";
	sourceRefs: TeamSourceRef[];
	createdAt: string;
	updatedAt: string;
};

export type MailboxWakeMessage = {
	messageId: string;
	agentTeamId: string;
	fromMemberId: string;
	toMemberId?: string;
	body: { message: string; summary?: string; type?: string };
	sourceRefs: TeamSourceRef[];
	readAt?: string;
	wakeStatus: TeamMailboxWakeStatus;
	createdAt: string;
};

export type TeamTaskLocalBody = {
	title: string;
	description?: string;
};

export type AgentTeamTaskLocalRow = AgentTeamTaskRow & {
	body_local_json: string;
};

type AgentTeamMailboxMessageLocalRow = AgentTeamMailboxMessageRow & {
	body_local_json: string;
	wake_error_json: string | null;
};

function rowToWakeMessage(
	row: AgentTeamMailboxMessageLocalRow,
): MailboxWakeMessage {
	return {
		messageId: row.message_id,
		agentTeamId: row.agent_team_id,
		fromMemberId: row.from_member_id,
		toMemberId: row.to_member_id ?? undefined,
		body: parseMailboxBody(row.body_local_json),
		sourceRefs: parseSourceRefs(row.source_refs_json),
		readAt: row.read_at ?? undefined,
		wakeStatus: row.wake_status as TeamMailboxWakeStatus,
		createdAt: row.created_at,
	};
}

function parseMailboxBody(value: string): MailboxWakeMessage["body"] {
	const parsed = JSON.parse(value) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { message: "" };
	}
	const record = parsed as Record<string, unknown>;
	return {
		message: typeof record.message === "string" ? record.message : "",
		summary: typeof record.summary === "string" ? record.summary : undefined,
		type: typeof record.type === "string" ? record.type : undefined,
	};
}

function parseSourceRefs(value: string | null): TeamSourceRef[] {
	if (!value) {
		return [];
	}
	const parsed = JSON.parse(value) as unknown;
	return Array.isArray(parsed) ? (parsed as TeamSourceRef[]) : [];
}

function mergeSourceRefs(
	existingRefs: TeamSourceRef[],
	newRefs: TeamSourceRef[],
): TeamSourceRef[] {
	const merged: TeamSourceRef[] = [];
	const seen = new Set<string>();
	for (const ref of [...existingRefs, ...newRefs]) {
		const key = JSON.stringify(ref);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(ref);
	}
	return merged;
}

function parseTaskBody(value: string): TeamTaskLocalBody {
	const parsed = JSON.parse(value) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { title: "" };
	}
	const record = parsed as Record<string, unknown>;
	return {
		title: typeof record.title === "string" ? record.title : "",
		description:
			typeof record.description === "string" ? record.description : undefined,
	};
}

function parseJsonStringArray(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function appendUnique(values: string[], value: string): string[] {
	return values.includes(value) ? values : [...values, value];
}

function assertTaskIdsExist(
	rows: AgentTeamTaskLocalRow[],
	taskIds: string[],
): void {
	const known = new Set(rows.map((row) => row.task_id));
	const missing = taskIds.find((taskId) => !known.has(taskId));
	if (missing) {
		throw new Error(`Unknown task dependency: ${missing}`);
	}
}

function requireTask(
	row: AgentTeamTaskLocalRow | null,
	taskId: string,
): AgentTeamTaskLocalRow {
	if (!row) {
		throw new Error(`Task not found: ${taskId}`);
	}
	return row;
}
