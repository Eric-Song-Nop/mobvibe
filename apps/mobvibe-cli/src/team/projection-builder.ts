import type {
	AgentTeamLifecycle,
	AgentTeamSummary,
	ErrorDetail,
	TeamMailboxCounts,
	TeamMcpStatusSummary,
	TeamMemberHealth,
	TeamMemberLifecycle,
	TeamMemberSummary,
	TeamSourceRef,
	TeamSummaryRef,
	TeamTaskCounts,
	TeamWorkspaceMode,
} from "@mobvibe/shared";
import { isErrorDetail } from "@mobvibe/shared";

export type AgentTeamProjectionInput = {
	team: AgentTeamRow;
	members: AgentTeamMemberRow[];
	mcpStatuses: AgentTeamMcpStatusRow[];
	mailboxMessages: AgentTeamMailboxMessageRow[];
	tasks: AgentTeamTaskRow[];
	summaryRefs: AgentTeamSummaryRefRow[];
};

export function buildAgentTeamSummary(
	input: AgentTeamProjectionInput,
): AgentTeamSummary {
	const lifecycle = parseAgentTeamLifecycle(input.team.lifecycle);
	const members = input.members.map((row) =>
		buildMemberSummary(
			row,
			input.mcpStatuses,
			input.mailboxMessages,
			input.tasks,
		),
	);
	const summary: AgentTeamSummary = {
		agentTeamId: input.team.agent_team_id,
		machineId: input.team.machine_id,
		title: input.team.title,
		workspaceRootCwd: input.team.workspace_root_cwd,
		workspaceMode: input.team.workspace_mode as TeamWorkspaceMode,
		leaderMemberId: input.team.leader_member_id,
		lifecycle,
		members,
		mailboxCounts: buildMailboxCounts(input.mailboxMessages),
		taskCounts: buildTaskCounts(input.tasks),
		summaryRefs: buildSummaryRefs(input.summaryRefs),
		sourceRefs: collectSourceRefs([...input.mailboxMessages, ...input.tasks]),
		createdAt: input.team.created_at,
		updatedAt: input.team.updated_at,
		archivedAt: input.team.archived_at ?? undefined,
	};

	return withoutEmptyCollections(summary);
}

function buildMemberSummary(
	row: AgentTeamMemberRow,
	mcpStatuses: AgentTeamMcpStatusRow[],
	mailboxMessages: AgentTeamMailboxMessageRow[],
	tasks: AgentTeamTaskRow[],
): TeamMemberSummary {
	const memberMessages = mailboxMessages.filter(
		(message) =>
			message.from_member_id === row.member_id ||
			message.to_member_id === row.member_id,
	);
	const memberTasks = tasks.filter(
		(task) => task.owner_member_id === row.member_id,
	);
	const sourceRefs = collectSourceRefs([...memberMessages, ...memberTasks]);
	return {
		memberId: row.member_id,
		agentTeamId: row.agent_team_id,
		role: row.role as "leader" | "member",
		name: row.name,
		backendId: row.backend_id,
		sessionId: row.session_id ?? undefined,
		lifecycle: parseTeamMemberLifecycle(row.lifecycle),
		health: row.health as TeamMemberHealth,
		mcp: buildMcpStatus(
			mcpStatuses.find((status) => status.member_id === row.member_id),
		),
		mailboxCounts: buildMailboxCounts(memberMessages),
		taskCounts: buildTaskCounts(memberTasks),
		pendingPermissionCount: 0,
		sourceRefs: sourceRefs.length ? sourceRefs : undefined,
		worktreeSourceCwd: row.worktree_source_cwd ?? undefined,
		worktreeBranch: row.worktree_branch ?? undefined,
		error: parseErrorDetail(row.error_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function buildMcpStatus(
	row: AgentTeamMcpStatusRow | undefined,
): TeamMcpStatusSummary | undefined {
	if (!row) return undefined;
	return {
		transport: row.transport as TeamMcpStatusSummary["transport"],
		phase: row.phase as TeamMcpStatusSummary["phase"],
		serverId: row.server_id ?? undefined,
		updatedAt: row.updated_at,
		error: parseErrorDetail(row.last_error_json),
	};
}

function buildMailboxCounts(
	rows: AgentTeamMailboxMessageRow[],
): TeamMailboxCounts {
	const count = rows.reduce(
		(result, row) => ({
			unread: result.unread + (row.read_at ? 0 : 1),
			wakePending: result.wakePending + (row.wake_status === "pending" ? 1 : 0),
			wakeFailed: result.wakeFailed + (row.wake_status === "failed" ? 1 : 0),
			lastMailboxAt:
				!result.lastMailboxAt || row.created_at > result.lastMailboxAt
					? row.created_at
					: result.lastMailboxAt,
		}),
		{ unread: 0, wakePending: 0, wakeFailed: 0 } as TeamMailboxCounts,
	);
	return count.lastMailboxAt ? count : { ...count, lastMailboxAt: undefined };
}

function buildTaskCounts(rows: AgentTeamTaskRow[]): TeamTaskCounts {
	const count = rows.reduce(
		(result, row) => ({
			todo: result.todo + (row.status === "todo" ? 1 : 0),
			inProgress: result.inProgress + (row.status === "in_progress" ? 1 : 0),
			blocked: result.blocked + (isBlockedTask(row) ? 1 : 0),
			completed: result.completed + (row.status === "completed" ? 1 : 0),
			failed: result.failed + (row.status === "failed" ? 1 : 0),
			cancelled: result.cancelled + (row.status === "cancelled" ? 1 : 0),
			lastTaskUpdatedAt:
				!result.lastTaskUpdatedAt || row.updated_at > result.lastTaskUpdatedAt
					? row.updated_at
					: result.lastTaskUpdatedAt,
		}),
		{
			todo: 0,
			inProgress: 0,
			blocked: 0,
			completed: 0,
			failed: 0,
			cancelled: 0,
		} as TeamTaskCounts,
	);
	return count.lastTaskUpdatedAt
		? count
		: { ...count, lastTaskUpdatedAt: undefined };
}

function buildSummaryRefs(rows: AgentTeamSummaryRefRow[]): TeamSummaryRef[] {
	return rows.map((row) => ({
		summaryRefId: row.summary_ref_id,
		agentTeamId: row.agent_team_id,
		status: row.status as TeamSummaryRef["status"],
		sourceRefs: parseSourceRefs(row.source_refs_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}));
}

function parseSourceRefs(value: string | null): TeamSourceRef[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter(isTeamSourceRef) : [];
	} catch {
		return [];
	}
}

function parseErrorDetail(value: string | null): ErrorDetail | undefined {
	if (!value) return undefined;
	const parsed = JSON.parse(value) as unknown;
	return isErrorDetail(parsed) ? parsed : undefined;
}

function parseAgentTeamLifecycle(value: string): AgentTeamLifecycle {
	if (isAgentTeamLifecycle(value)) return value;
	throw new Error(`Invalid Agent Team lifecycle: ${value}`);
}

function parseTeamMemberLifecycle(value: string): TeamMemberLifecycle {
	if (isTeamMemberLifecycle(value)) return value;
	throw new Error(`Invalid Agent Team member lifecycle: ${value}`);
}

function isAgentTeamLifecycle(value: string): value is AgentTeamLifecycle {
	return AGENT_TEAM_LIFECYCLES.includes(value as AgentTeamLifecycle);
}

function isTeamMemberLifecycle(value: string): value is TeamMemberLifecycle {
	return TEAM_MEMBER_LIFECYCLES.includes(value as TeamMemberLifecycle);
}

function collectSourceRefs(
	rows: Array<AgentTeamMailboxMessageRow | AgentTeamTaskRow>,
): TeamSourceRef[] {
	return rows.flatMap((row) => parseSourceRefs(row.source_refs_json));
}

function isBlockedTask(row: AgentTeamTaskRow): boolean {
	return (
		row.status === "blocked" || parseStringArray(row.blocked_by_json).length > 0
	);
}

function parseStringArray(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter(isString) : [];
	} catch {
		return [];
	}
}

function withoutEmptyCollections(summary: AgentTeamSummary): AgentTeamSummary {
	const next = { ...summary };
	if (!next.summaryRefs?.length) {
		delete next.summaryRefs;
	}
	if (!next.sourceRefs?.length) {
		delete next.sourceRefs;
	}
	return next;
}

function isTeamSourceRef(value: unknown): value is TeamSourceRef {
	if (!isRecord(value) || !isString(value.type)) return false;
	if (value.type === "session_event") {
		return (
			isString(value.agentTeamId) &&
			isString(value.memberId) &&
			isString(value.sessionId) &&
			Number.isInteger(value.revision) &&
			Number.isInteger(value.seq)
		);
	}
	if (value.type === "member_session") {
		return (
			isString(value.agentTeamId) &&
			isString(value.memberId) &&
			isString(value.sessionId)
		);
	}
	if (value.type === "mailbox_message") {
		return (
			isString(value.agentTeamId) &&
			isString(value.messageId) &&
			isString(value.fromMemberId) &&
			isOptionalString(value.toMemberId) &&
			isOptionalString(value.deliveredSessionId)
		);
	}
	if (value.type === "task") {
		return (
			isString(value.agentTeamId) &&
			isString(value.taskId) &&
			isOptionalString(value.ownerMemberId)
		);
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || isString(value);
}

const AGENT_TEAM_LIFECYCLES: AgentTeamLifecycle[] = [
	"pending",
	"starting",
	"running",
	"completed",
	"failed",
	"cancelled",
	"archived",
];

const TEAM_MEMBER_LIFECYCLES: TeamMemberLifecycle[] = [
	"pending",
	"creating_session",
	"running",
	"completed",
	"failed",
	"cancelled",
	"detached",
	"archived",
];

export type AgentTeamRow = {
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

export type AgentTeamMemberRow = {
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
	error_json: string | null;
	created_at: string;
	updated_at: string;
};

export type AgentTeamMcpStatusRow = {
	agent_team_id: string;
	member_id: string;
	transport: string;
	server_id: string | null;
	phase: string;
	last_error_json: string | null;
	updated_at: string;
};

export type AgentTeamMailboxMessageRow = {
	message_id: string;
	agent_team_id: string;
	from_member_id: string;
	to_member_id: string | null;
	source_refs_json: string | null;
	read_at: string | null;
	wake_status: string;
	created_at: string;
};

export type AgentTeamTaskRow = {
	task_id: string;
	agent_team_id: string;
	owner_member_id: string | null;
	status: string;
	source_refs_json: string | null;
	blocked_by_json: string | null;
	blocks_json: string | null;
	created_at: string;
	updated_at: string;
};

export type AgentTeamSummaryRefRow = {
	summary_ref_id: string;
	agent_team_id: string;
	source_refs_json: string;
	status: string;
	created_at: string;
	updated_at: string;
};
