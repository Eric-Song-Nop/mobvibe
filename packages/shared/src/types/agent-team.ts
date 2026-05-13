import type { ErrorDetail } from "./errors.js";

export type AgentTeamId = string;
export type TeamMemberId = string;
export type TeamMailboxMessageId = string;
export type TeamTaskId = string;
export type TeamSummaryRefId = string;

export type AgentTeamLifecycle =
	| "pending"
	| "starting"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "archived";

export type TeamMemberLifecycle =
	| "pending"
	| "creating_session"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "detached"
	| "archived";

export type TeamMcpPhase =
	| "not_started"
	| "server_starting"
	| "server_ready"
	| "session_injecting"
	| "tools_waiting"
	| "tools_ready"
	| "degraded"
	| "error";

export type TeamMcpTransport = "acp" | "stdio_bridge" | "http_bridge";

export type TeamMemberHealth = "healthy" | "degraded" | "error";

export type TeamWorkspaceMode = "shared_workspace" | "per_member_worktree";

export type TeamMailboxWakeStatus =
	| "not_needed"
	| "pending"
	| "sent"
	| "failed";

export type TeamTaskStatus =
	| "todo"
	| "in_progress"
	| "blocked"
	| "completed"
	| "failed"
	| "cancelled";

export type TeamMailboxCounts = {
	unread: number;
	wakePending: number;
	wakeFailed: number;
	lastMailboxAt?: string;
};

export type TeamTaskCounts = {
	todo: number;
	inProgress: number;
	blocked: number;
	completed: number;
	failed: number;
	cancelled: number;
	lastTaskUpdatedAt?: string;
};

export type TeamMcpStatusSummary = {
	transport: TeamMcpTransport;
	phase: TeamMcpPhase;
	serverId?: string;
	updatedAt: string;
	error?: ErrorDetail;
};

export type TeamSourceRef =
	| {
			type: "session_event";
			agentTeamId: AgentTeamId;
			memberId: TeamMemberId;
			sessionId: string;
			revision: number;
			seq: number;
	  }
	| {
			type: "member_session";
			agentTeamId: AgentTeamId;
			memberId: TeamMemberId;
			sessionId: string;
	  }
	| {
			type: "mailbox_message";
			agentTeamId: AgentTeamId;
			messageId: TeamMailboxMessageId;
			fromMemberId: TeamMemberId;
			toMemberId?: TeamMemberId;
			deliveredSessionId?: string;
	  }
	| {
			type: "task";
			agentTeamId: AgentTeamId;
			taskId: TeamTaskId;
			ownerMemberId?: TeamMemberId;
	  };

export type TeamSummaryRef = {
	summaryRefId: TeamSummaryRefId;
	agentTeamId: AgentTeamId;
	status: "pending" | "ready" | "failed";
	sourceRefs: TeamSourceRef[];
	createdAt: string;
	updatedAt: string;
	error?: ErrorDetail;
};

export type TeamMemberSummary = {
	memberId: TeamMemberId;
	agentTeamId: AgentTeamId;
	role: "leader" | "member";
	name: string;
	backendId: string;
	sessionId?: string;
	lifecycle: TeamMemberLifecycle;
	health: TeamMemberHealth;
	mcp?: TeamMcpStatusSummary;
	mailboxCounts: TeamMailboxCounts;
	taskCounts: TeamTaskCounts;
	pendingPermissionCount: number;
	pendingPermissionRequestIds?: string[];
	worktreeSourceCwd?: string;
	worktreeBranch?: string;
	lastActivityAt?: string;
	sourceRefs?: TeamSourceRef[];
	error?: ErrorDetail;
	createdAt: string;
	updatedAt: string;
};

export type AgentTeamSummary = {
	agentTeamId: AgentTeamId;
	machineId: string;
	title: string;
	workspaceRootCwd: string;
	workspaceMode: TeamWorkspaceMode;
	leaderMemberId: TeamMemberId;
	lifecycle: AgentTeamLifecycle;
	members: TeamMemberSummary[];
	mailboxCounts: TeamMailboxCounts;
	taskCounts: TeamTaskCounts;
	summaryRefs?: TeamSummaryRef[];
	sourceRefs?: TeamSourceRef[];
	error?: ErrorDetail;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
};

export type CreateAgentTeamRpcParams = {
	machineId: string;
	backendId: string;
	workspaceRootCwd: string;
	title?: string;
	workspaceMode?: TeamWorkspaceMode;
	leaderName?: string;
};

export type CreateAgentTeamRpcResult = {
	team: AgentTeamSummary;
};

export type ListAgentTeamsRpcParams = {
	machineId?: string;
	includeArchived?: boolean;
};

export type ListAgentTeamsRpcResult = {
	teams: AgentTeamSummary[];
};

export type GetAgentTeamRpcParams = {
	agentTeamId: AgentTeamId;
	machineId?: string;
};

export type GetAgentTeamRpcResult = {
	team?: AgentTeamSummary;
};

export type AgentTeamsChangedPayload = {
	added: AgentTeamSummary[];
	updated: AgentTeamSummary[];
	removed: AgentTeamId[];
	machineId?: string;
};
