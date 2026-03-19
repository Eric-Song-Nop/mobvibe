import type {
	AvailableCommand,
	PlanEntry,
	SessionConfigOption,
	SessionNotification,
	ToolCallUpdate,
} from "@mobvibe/shared";

// Core-specific types (UI/extraction helpers)
export type SessionTextChunk = {
	role: "user" | "assistant";
	text: string;
	messageId?: string;
};

export type SessionModeUpdate = {
	modeId: string;
};

export type SessionInfoPayload = {
	title?: string;
	updatedAt?: string;
	_meta?: Record<string, unknown> | null;
};

export type ConfigOptionUpdatePayload = {
	configOptions: SessionConfigOption[];
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
		return {
			role: "user",
			text: update.content.text,
			messageId: update.messageId ?? undefined,
		};
	}

	return {
		role: "assistant",
		text: update.content.text,
		messageId: update.messageId ?? undefined,
	};
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

export type PlanUpdatePayload = {
	entries: PlanEntry[];
};

export const extractPlanUpdate = (
	notification: SessionNotification,
): PlanUpdatePayload | null => {
	const { update } = notification;
	if (update.sessionUpdate !== "plan") {
		return null;
	}
	const planUpdate = update as unknown as { entries?: PlanEntry[] };
	return { entries: planUpdate.entries ?? [] };
};

export const extractAvailableCommandsUpdate = (
	notification: SessionNotification,
): AvailableCommand[] | null => {
	if (notification.update.sessionUpdate !== "available_commands_update") {
		return null;
	}
	return notification.update.availableCommands ?? [];
};

export const extractConfigOptionUpdate = (
	notification: SessionNotification,
): ConfigOptionUpdatePayload | null => {
	if (notification.update.sessionUpdate !== "config_option_update") {
		return null;
	}
	return { configOptions: notification.update.configOptions ?? [] };
};
