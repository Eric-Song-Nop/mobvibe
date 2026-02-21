import type { EncryptedPayload } from "../crypto/types.js";
import type {
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
	StopReason,
} from "./acp.js";
import type { ErrorDetail } from "./errors.js";
import type {
	AcpBackendId,
	AcpBackendSummary,
	AcpSessionInfo,
	AgentSessionCapabilities,
	FsEntry,
	FsRoot,
	SessionFsResourceEntry,
	SessionSummary,
	SessionsChangedPayload,
} from "./session.js";

// Session event types for WAL-based persistence

/** Event kinds stored in the CLI WAL */
export type SessionEventKind =
	| "user_message"
	| "agent_message_chunk"
	| "agent_thought_chunk"
	| "turn_end"
	| "tool_call"
	| "tool_call_update"
	| "permission_request"
	| "permission_result"
	| "terminal_output"
	| "session_info_update"
	| "session_error"
	| "usage_update"
	| "unknown_update";

/** A persisted session event with sequence tracking */
export type SessionEvent = {
	sessionId: string;
	machineId: string;
	revision: number;
	seq: number;
	kind: SessionEventKind;
	createdAt: string;
	payload: unknown;
};

/** Parameters for fetching session events (backfill) */
export type SessionEventsParams = {
	sessionId: string;
	revision: number;
	afterSeq: number;
	limit?: number;
};

/** Response from session events query */
export type SessionEventsResponse = {
	sessionId: string;
	machineId: string;
	revision: number;
	events: SessionEvent[];
	nextAfterSeq?: number;
	hasMore: boolean;
};

/** Acknowledgment payload for events received by gateway */
export type EventsAckPayload = {
	sessionId: string;
	revision: number;
	upToSeq: number;
};

// Permission request payload sent through Socket.io
export type PermissionRequestPayload = {
	sessionId: string;
	requestId: string;
	options: PermissionOption[];
	toolCall?: PermissionToolCall;
};

// Permission decision payload sent through Socket.io
export type PermissionDecisionPayload = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};

// CLI registration info
export type CliRegistrationInfo = {
	machineId: string;
	hostname: string;
	version?: string;
	backends?: AcpBackendSummary[];
};

// CLI error payload (sent when auth fails)
export type CliErrorPayload = {
	code: string;
	message: string;
};

// CLI status update
export type CliStatusPayload = {
	machineId: string;
	connected: boolean;
	hostname?: string;
	sessionCount?: number;
	/** User ID (only present when auth is enabled) */
	userId?: string;
	/** Per-backend capabilities (sent when available) */
	backendCapabilities?: Record<string, AgentSessionCapabilities>;
};

// Stream error event
export type StreamErrorPayload = {
	sessionId: string;
	error: ErrorDetail;
};

// RPC request wrapper
export type RpcRequest<TParams> = {
	requestId: string;
	params: TParams;
};

// RPC response wrapper
export type RpcResponse<TResult> = {
	requestId: string;
	result?: TResult;
	error?: ErrorDetail;
};

// Create session RPC params
export type CreateSessionParams = {
	cwd?: string;
	title?: string;
	backendId: AcpBackendId;
	machineId?: string;
};

// Send message RPC params
export type SendMessageParams = {
	sessionId: string;
	prompt: EncryptedPayload;
};

// Send message RPC result
export type SendMessageResult = {
	stopReason: StopReason;
};

// Cancel session RPC params
export type CancelSessionParams = {
	sessionId: string;
};

// Set session mode RPC params
export type SetSessionModeParams = {
	sessionId: string;
	modeId: string;
};

// Set session model RPC params
export type SetSessionModelParams = {
	sessionId: string;
	modelId: string;
};

// File system RPC params
export type FsEntriesParams = {
	sessionId: string;
	path?: string;
};

// Host file system RPC params
export type HostFsRootsParams = {
	machineId: string;
};

export type HostFsEntriesParams = {
	machineId: string;
	path: string;
};

export type FsFileParams = {
	sessionId: string;
	path: string;
};

export type FsResourcesParams = {
	sessionId: string;
};

// File system RPC responses
export type FsRootsResponse = {
	root: FsRoot;
};

export type FsEntriesResponse = {
	path: string;
	entries: FsEntry[];
};

export type FsResourcesResponse = {
	rootPath: string;
	entries: SessionFsResourceEntry[];
};

export type HostFsRootsResponse = {
	homePath: string;
	roots: FsRoot[];
};

// Session discovery RPC params
export type DiscoverSessionsRpcParams = {
	cwd?: string;
	backendId: string;
	cursor?: string;
};

// Session discovery RPC response
export type DiscoverSessionsRpcResult = {
	sessions: AcpSessionInfo[];
	capabilities: AgentSessionCapabilities;
	nextCursor?: string;
};

// Load session RPC params
export type LoadSessionRpcParams = {
	sessionId: string;
	cwd: string;
	backendId: string;
};

// Reload session RPC params
export type ReloadSessionRpcParams = {
	sessionId: string;
	cwd: string;
	backendId: string;
};

/** Payload for sessions:discovered event */
export type SessionsDiscoveredPayload = {
	sessions: AcpSessionInfo[];
	capabilities: AgentSessionCapabilities;
	nextCursor?: string;
	backendId: string;
	backendLabel: string;
};

export type SessionAttachedPayload = {
	sessionId: string;
	machineId: string;
	attachedAt: string;
	/** Current WAL revision for this session */
	revision?: number;
};

export type SessionDetachedPayload = {
	sessionId: string;
	machineId: string;
	detachedAt: string;
	reason: "agent_exit" | "cli_disconnect" | "gateway_disconnect" | "unknown";
};

// CLI -> Gateway events
// Note: session:update, session:error, terminal:output are deprecated
// All content now flows through session:event with appropriate kind
export interface CliToGatewayEvents {
	"cli:register": (info: CliRegistrationInfo) => void;
	"cli:heartbeat": () => void;
	"session:event": (event: SessionEvent) => void;
	"session:attached": (payload: SessionAttachedPayload) => void;
	"session:detached": (payload: SessionDetachedPayload) => void;
	"permission:request": (payload: PermissionRequestPayload) => void;
	"permission:result": (payload: PermissionDecisionPayload) => void;
	"sessions:list": (sessions: SessionSummary[]) => void;
	"sessions:changed": (payload: SessionsChangedPayload) => void;
	"sessions:discovered": (payload: SessionsDiscoveredPayload) => void;

	// RPC responses
	"rpc:response": (response: RpcResponse<unknown>) => void;
}

// Gateway -> CLI events
export interface GatewayToCliEvents {
	"cli:registered": (info: { machineId: string; userId?: string }) => void;
	"cli:error": (payload: CliErrorPayload) => void;
	"events:ack": (payload: EventsAckPayload) => void;

	// RPC requests
	"rpc:session:create": (request: RpcRequest<CreateSessionParams>) => void;
	"rpc:session:cancel": (request: RpcRequest<CancelSessionParams>) => void;
	"rpc:session:mode": (request: RpcRequest<SetSessionModeParams>) => void;
	"rpc:session:model": (request: RpcRequest<SetSessionModelParams>) => void;
	"rpc:message:send": (request: RpcRequest<SendMessageParams>) => void;
	"rpc:permission:decision": (
		request: RpcRequest<PermissionDecisionPayload>,
	) => void;
	"rpc:session:events": (request: RpcRequest<SessionEventsParams>) => void;

	// File system RPC requests
	"rpc:fs:roots": (request: RpcRequest<{ sessionId: string }>) => void;
	"rpc:fs:entries": (request: RpcRequest<FsEntriesParams>) => void;
	"rpc:fs:file": (request: RpcRequest<FsFileParams>) => void;
	"rpc:fs:resources": (request: RpcRequest<FsResourcesParams>) => void;
	"rpc:hostfs:roots": (request: RpcRequest<HostFsRootsParams>) => void;
	"rpc:hostfs:entries": (request: RpcRequest<HostFsEntriesParams>) => void;

	// Session discovery RPC requests
	"rpc:sessions:discover": (
		request: RpcRequest<DiscoverSessionsRpcParams>,
	) => void;
	"rpc:session:load": (request: RpcRequest<LoadSessionRpcParams>) => void;
	"rpc:session:reload": (request: RpcRequest<ReloadSessionRpcParams>) => void;

	// Rename RPC request
	"rpc:session:rename": (request: RpcRequest<RenameSessionParams>) => void;

	// Archive RPC requests
	"rpc:session:archive": (request: RpcRequest<ArchiveSessionParams>) => void;
	"rpc:session:archive-all": (
		request: RpcRequest<BulkArchiveSessionsParams>,
	) => void;

	// Git RPC requests
	"rpc:git:status": (request: RpcRequest<GitStatusParams>) => void;
	"rpc:git:fileDiff": (request: RpcRequest<GitFileDiffParams>) => void;
	"rpc:git:log": (request: RpcRequest<GitLogParams>) => void;
	"rpc:git:show": (request: RpcRequest<GitShowParams>) => void;
	"rpc:git:blame": (request: RpcRequest<GitBlameParams>) => void;
	"rpc:git:branches": (request: RpcRequest<GitBranchesParams>) => void;
	"rpc:git:stashList": (request: RpcRequest<GitStashListParams>) => void;
	"rpc:git:statusExtended": (
		request: RpcRequest<GitStatusExtendedParams>,
	) => void;
	"rpc:git:searchLog": (request: RpcRequest<GitSearchLogParams>) => void;
	"rpc:git:fileHistory": (request: RpcRequest<GitFileHistoryParams>) => void;
	"rpc:git:grep": (request: RpcRequest<GitGrepParams>) => void;
}

// Webui -> Gateway events
export interface WebuiToGatewayEvents {
	"subscribe:session": (payload: { sessionId: string }) => void;
	"unsubscribe:session": (payload: { sessionId: string }) => void;
}

// Gateway -> Webui events
// Note: session:update, session:error, terminal:output are deprecated
// All content now flows through session:event with appropriate kind
export interface GatewayToWebuiEvents {
	"session:event": (event: SessionEvent) => void;
	"session:attached": (payload: SessionAttachedPayload) => void;
	"session:detached": (payload: SessionDetachedPayload) => void;
	"permission:request": (payload: PermissionRequestPayload) => void;
	"permission:result": (payload: PermissionDecisionPayload) => void;
	"cli:status": (payload: CliStatusPayload) => void;
	"sessions:changed": (payload: SessionsChangedPayload) => void;
}

// Rename session RPC params
export type RenameSessionParams = { sessionId: string; title: string };

// Archive session RPC params
export type ArchiveSessionParams = { sessionId: string };
export type BulkArchiveSessionsParams = { sessionIds: string[] };

// Git file status codes (from git status --porcelain)
export type GitFileStatus = "M" | "A" | "D" | "?" | "R" | "C" | "U" | "!";

// Git status params/response
export type GitStatusParams = { sessionId: string };
export type GitStatusResponse = {
	isGitRepo: boolean;
	branch?: string;
	files: Array<{ path: string; status: GitFileStatus }>;
	dirStatus: Record<string, GitFileStatus>;
};

// Git file diff params/response
export type GitFileDiffParams = { sessionId: string; path: string };
export type GitFileDiffResponse = {
	isGitRepo: boolean;
	path: string;
	addedLines: number[];
	modifiedLines: number[];
	deletedLines: number[];
};

// Extended git types for RPC
export type GitLogEntry = {
	hash: string;
	shortHash: string;
	author: string;
	authorEmail: string;
	date: string;
	subject: string;
	body?: string;
	filesChanged?: number;
	insertions?: number;
	deletions?: number;
};

export type GitCommitDetail = GitLogEntry & {
	files: Array<{
		path: string;
		status: "A" | "M" | "D" | "R" | "C";
		oldPath?: string;
		insertions: number;
		deletions: number;
	}>;
};

export type GitBlameLine = {
	lineNumber: number;
	commitHash: string;
	shortHash: string;
	author: string;
	date: string;
	content: string;
};

export type GitBranch = {
	name: string;
	current: boolean;
	remote?: string;
	upstream?: string;
	aheadBehind?: { ahead: number; behind: number };
	lastCommitDate?: string;
};

export type GitStashEntry = {
	index: number;
	message: string;
	date: string;
	branchName?: string;
};

export type GitStatusExtended = {
	branch?: string;
	staged: Array<{ path: string; status: GitFileStatus }>;
	unstaged: Array<{ path: string; status: GitFileStatus }>;
	untracked: Array<{ path: string }>;
	dirStatus: Record<string, GitFileStatus>;
};

export type GrepResult = {
	path: string;
	lineNumber: number;
	content: string;
	matchStart: number;
	matchEnd: number;
};

// Git RPC params/response types
export type GitLogParams = {
	sessionId: string;
	maxCount?: number;
	skip?: number;
	path?: string;
	author?: string;
	search?: string;
};
export type GitLogResponse = {
	entries: GitLogEntry[];
	hasMore: boolean;
};

export type GitShowParams = { sessionId: string; hash: string };
export type GitShowResponse = GitCommitDetail;

export type GitBlameParams = {
	sessionId: string;
	path: string;
	startLine?: number;
	endLine?: number;
};
export type GitBlameResponse = { lines: GitBlameLine[] };

export type GitBranchesParams = { sessionId: string };
export type GitBranchesResponse = { branches: GitBranch[] };

export type GitStashListParams = { sessionId: string };
export type GitStashListResponse = { entries: GitStashEntry[] };

export type GitStatusExtendedParams = { sessionId: string };
export type GitStatusExtendedResponse = GitStatusExtended & {
	isGitRepo: boolean;
};

export type GitSearchLogParams = {
	sessionId: string;
	query: string;
	type: "message" | "diff" | "author";
	maxCount?: number;
};
export type GitSearchLogResponse = { entries: GitLogEntry[] };

export type GitFileHistoryParams = {
	sessionId: string;
	path: string;
	maxCount?: number;
};
export type GitFileHistoryResponse = { entries: GitLogEntry[] };

export type GitGrepParams = {
	sessionId: string;
	query: string;
	caseSensitive?: boolean;
	regex?: boolean;
	glob?: string;
};
export type GitGrepResponse = { results: GrepResult[]; truncated: boolean };

// HTTP API response types (used by gateway routes + webui client)
export type AcpBackendsResponse = {
	backends: AcpBackendSummary[];
};

export type SessionsResponse = {
	sessions: SessionSummary[];
};

export type CreateSessionResponse = SessionSummary;

export type CancelSessionResponse = {
	ok: boolean;
};

export type MessageIdResponse = {
	messageId: string;
};

export type SessionFsFilePreviewResponse = {
	path: string;
	previewType: import("./session.js").SessionFsFilePreviewType;
	content: string;
	mimeType?: string;
};

export type MachinesResponse = {
	machines: Array<{
		id: string;
		name?: string | null;
		hostname?: string | null;
		platform?: string | null;
		isOnline: boolean;
		lastSeenAt?: string | null;
		createdAt?: string | null;
	}>;
};

export type PermissionDecisionResponse = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};
