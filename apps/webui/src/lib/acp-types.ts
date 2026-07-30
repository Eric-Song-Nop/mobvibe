import type {
	AvailableCommand,
	PlanEntry,
	PlanOperationSessionUpdate,
	SessionNotification,
	ToolCallUpdate,
} from "@mobvibe/shared";
import { sanitizePlanSessionUpdate } from "@mobvibe/shared";

// Core-specific types (UI/extraction helpers)
export type SessionTextChunk = {
	role: "user" | "assistant";
	text: string;
};

export type SessionModeUpdate = {
	modeId: string;
};

export type SessionInfoPayload = {
	title?: string | null;
	updatedAt?: string | null;
	_meta?: Record<string, unknown> | null;
};

// Extraction utility functions (these work with SDK types)
export const extractTextChunk = (
	notification: SessionNotification,
): SessionTextChunk | null => {
	const { update } = notification;
	if (
		update.sessionUpdate !== "user_message_chunk" &&
		update.sessionUpdate !== "agent_message_chunk" &&
		update.sessionUpdate !== "agent_thought_chunk"
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
	const result: SessionInfoPayload = {};
	if (
		"title" in notification.update &&
		notification.update.title !== undefined
	) {
		result.title = notification.update.title;
	}
	if (
		"updatedAt" in notification.update &&
		notification.update.updatedAt !== undefined
	) {
		result.updatedAt = notification.update.updatedAt;
	}
	if (
		"_meta" in notification.update &&
		notification.update._meta !== undefined
	) {
		result._meta = notification.update._meta;
	}
	if (Object.keys(result).length === 0) {
		return null;
	}
	return result;
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

export type PlanUpdatePayload = {
	entries: PlanEntry[];
};

export const extractPlanUpdate = (
	notification: SessionNotification,
): PlanUpdatePayload | null => {
	const update = sanitizePlanSessionUpdate(notification.update);
	return update?.sessionUpdate === "plan" ? { entries: update.entries } : null;
};

export const extractPlanOperationUpdate = (
	notification: SessionNotification,
): PlanOperationSessionUpdate | null => {
	const update = sanitizePlanSessionUpdate(notification.update);
	return update?.sessionUpdate === "plan_update" ||
		update?.sessionUpdate === "plan_removed"
		? update
		: null;
};

export const extractAvailableCommandsUpdate = (
	notification: SessionNotification,
): AvailableCommand[] | null => {
	if (notification.update.sessionUpdate !== "available_commands_update") {
		return null;
	}
	return notification.update.availableCommands ?? [];
};
