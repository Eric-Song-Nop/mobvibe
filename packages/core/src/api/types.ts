// Re-export shared types
export * from "@mobvibe/shared";

// Import types needed for extraction functions and local types
import type {
	AvailableCommand,
	FsEntry,
	FsRoot,
	PermissionOutcome,
	SessionFsFilePreviewType,
	SessionFsResourceEntry,
	SessionNotification,
	SessionSummary,
	StopReason,
	ToolCallUpdate,
} from "@mobvibe/shared";

// Core-specific types (UI/extraction helpers)
export type SessionTextChunk = {
	role: "user" | "assistant";
	text: string;
};

export type SessionModeUpdate = {
	modeId: string;
};

export type SessionInfoPayload = {
	title?: string;
	updatedAt?: string;
};

// API Response types (core-specific)
export type AcpBackendsResponse = {
	defaultBackendId: string;
	backends: { backendId: string; backendLabel: string }[];
};

export type FsRootsResponse = {
	homePath: string;
	roots: FsRoot[];
};

export type SessionFsRoot = {
	name: string;
	path: string;
};

export type SessionFsRootsResponse = {
	root: SessionFsRoot;
};

export type SessionFsFilePreviewResponse = {
	path: string;
	previewType: SessionFsFilePreviewType;
	content: string;
	mimeType?: string;
};

export type SessionFsResourcesResponse = {
	rootPath: string;
	entries: SessionFsResourceEntry[];
};

export type SessionsResponse = {
	sessions: SessionSummary[];
};

export type CreateSessionResponse = SessionSummary;

export type SendMessageResponse = {
	stopReason: StopReason;
};

export type CancelSessionResponse = {
	ok: boolean;
};

export type PermissionDecisionResponse = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};

export type MessageIdResponse = {
	messageId: string;
};

// Extraction utility functions (these work with SDK types)
export const extractTextChunk = (
	notification: SessionNotification,
): SessionTextChunk | null => {
	const { update } = notification;
	if (
		update.sessionUpdate !== "user_message_chunk" &&
		update.sessionUpdate !== "agent_message_chunk"
	) {
		return null;
	}
	if (update.content.type !== "text") {
		return null;
	}

	if (update.sessionUpdate === "user_message_chunk") {
		return { role: "user", text: update.content.text };
	}

	return { role: "assistant", text: update.content.text };
};

export const extractSessionModeUpdate = (
	notification: SessionNotification,
): SessionModeUpdate | null => {
	if (notification.update.sessionUpdate !== "current_mode_update") {
		return null;
	}
	return { modeId: notification.update.currentModeId };
};

export const extractSessionInfoUpdate = (
	notification: SessionNotification,
): SessionInfoPayload | null => {
	if (notification.update.sessionUpdate !== "session_info_update") {
		return null;
	}
	const title = notification.update.title ?? undefined;
	const updatedAt = notification.update.updatedAt ?? undefined;
	if (!title && !updatedAt) {
		return null;
	}
	return { title, updatedAt };
};

export const extractToolCallUpdate = (
	notification: SessionNotification,
): ToolCallUpdate | null => {
	const { update } = notification;
	if (
		update.sessionUpdate !== "tool_call" &&
		update.sessionUpdate !== "tool_call_update"
	) {
		return null;
	}
	return update as ToolCallUpdate;
};

export const extractAvailableCommandsUpdate = (
	notification: SessionNotification,
): AvailableCommand[] | null => {
	if (notification.update.sessionUpdate !== "available_commands_update") {
		return null;
	}
	return notification.update.availableCommands ?? [];
};
