import type { AvailableCommand } from "./acp.js";
import type { ErrorDetail } from "./errors.js";

export type AcpConnectionState =
	| "idle"
	| "connecting"
	| "ready"
	| "error"
	| "stopped";

export type AcpBackendId = "opencode" | "gemini-cli" | "claude-code";

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
	state: AcpConnectionState;
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
