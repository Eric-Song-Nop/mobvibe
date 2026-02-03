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
};

/** Sessions changed event payload for incremental sync */
export type SessionsChangedPayload = {
	/** Newly added sessions */
	added: SessionSummary[];
	/** Updated sessions */
	updated: SessionSummary[];
	/** Removed session IDs */
	removed: string[];
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
};

/** Agent session capabilities */
export type AgentSessionCapabilities = {
	list: boolean;
	load: boolean;
};

/** Parameters for discovering sessions from agent */
export type DiscoverSessionsParams = {
	machineId?: string;
	cwd?: string;
	cursor?: string;
};

/** Result of discovering sessions */
export type DiscoverSessionsResult = {
	sessions: AcpSessionInfo[];
	capabilities: AgentSessionCapabilities;
	nextCursor?: string;
};

/** Parameters for loading a historical session */
export type LoadSessionParams = {
	sessionId: string;
	cwd: string;
	machineId?: string;
};

/** Parameters for reloading a historical session */
export type ReloadSessionParams = {
	sessionId: string;
	cwd: string;
	machineId?: string;
};
