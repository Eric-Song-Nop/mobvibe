import type { AvailableCommand } from "./acp.js";
import type { ErrorDetail } from "./errors.js";

export type AcpConnectionState =
	| "idle"
	| "connecting"
	| "ready"
	| "error"
	| "stopped";

export type AcpBackendId = string;

export type AcpBackendSummary = {
	backendId: string;
	backendLabel: string;
};

export type SessionModeOption = {
	id: string;
	name: string;
};

export type SessionModelOption = {
	id: string;
	name: string;
	description?: string | null;
};

export type SessionSummary = {
	sessionId: string;
	title: string;
	backendId: string;
	backendLabel: string;
	error?: ErrorDetail;
	pid?: number;
	createdAt: string;
	updatedAt: string;
	cwd?: string;
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
	availableModes?: SessionModeOption[];
	availableModels?: SessionModelOption[];
	availableCommands?: AvailableCommand[];
	/** Machine ID that owns this session (populated by gateway) */
	machineId?: string;
	/** Current WAL revision for this session */
	revision?: number;
	/** Base64-encoded sealed DEK for E2EE (crypto_box_seal) */
	wrappedDek?: string;
	/** Agent-defined metadata from session_info_update RFD */
	_meta?: Record<string, unknown> | null;
	/** Original repo cwd (only for worktree sessions) */
	worktreeSourceCwd?: string;
	/** Branch name of the worktree (only for worktree sessions) */
	worktreeBranch?: string;
	/** Whether this session is currently attached (agent running) on the CLI */
	isAttached?: boolean;
};

/** Sessions changed event payload for incremental sync */
export type SessionsChangedPayload = {
	/** Newly added sessions */
	added: SessionSummary[];
	/** Updated sessions */
	updated: SessionSummary[];
	/** Removed session IDs */
	removed: string[];
	/** Per-backend capabilities from discovery */
	backendCapabilities?: Record<string, AgentSessionCapabilities>;
};

// StopReason is now re-exported from SDK via acp.ts

export type FsEntry = {
	name: string;
	path: string;
	type: "directory" | "file";
	hidden: boolean;
};

export type FsRoot = {
	name: string;
	path: string;
};

export type SessionFsFilePreviewType = "code" | "image";

export type SessionFsFilePreview = {
	path: string;
	previewType: SessionFsFilePreviewType;
	content: string;
	mimeType?: string;
};

export type SessionFsResourceEntry = {
	name: string;
	path: string;
	relativePath: string;
};

/** ACP session info returned from agent's session/list */
export type AcpSessionInfo = {
	sessionId: string;
	cwd: string;
	title?: string;
	updatedAt?: string;
	/** Agent-defined metadata from session_info_update RFD */
	_meta?: Record<string, unknown> | null;
};

/** Agent session capabilities */
export type AgentSessionCapabilities = {
	list: boolean;
	load: boolean;
};

/** Result of discovering sessions */
export type DiscoverSessionsResult = {
	sessions: AcpSessionInfo[];
	capabilities: AgentSessionCapabilities;
	nextCursor?: string;
};
