import type {
	AvailableCommand,
	SessionNotification,
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
	_meta?: Record<string, unknown> | null;
};

// Note: PermissionDecisionResponse kept here because gateway actually returns
// the decision payload back, which differs from the shared CancelSessionResponse.
export type PermissionDecisionResponse = {
	sessionId: string;
	requestId: string;
	outcome: import("@mobvibe/shared").PermissionOutcome;
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
	const _meta =
		"_meta" in notification.update
			? (notification.update as { _meta?: Record<string, unknown> | null })
					._meta
			: undefined;
	if (!title && !updatedAt && _meta === undefined) {
		return null;
	}
	return { title, updatedAt, _meta };
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
