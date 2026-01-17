export type SessionUpdateType =
	| "user_message_chunk"
	| "agent_message_chunk"
	| "agent_thought_chunk"
	| "tool_call"
	| "tool_call_update"
	| "plan"
	| "available_commands_update"
	| "current_mode_update"
	| "config_option_update"
	| "session_info_update";

export type SessionContent = {
	type: "text";
	text: string;
};

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolCallKind =
	| "read"
	| "edit"
	| "delete"
	| "move"
	| "search"
	| "execute"
	| "think"
	| "fetch"
	| "other";

export type ToolCallContentPayload = SessionContent | Record<string, unknown>;

export type ToolCallContent =
	| {
			type: "content";
			content: ToolCallContentPayload;
	  }
	| {
			type: "diff";
			path: string;
			oldText?: string | null;
			newText: string;
	  }
	| {
			type: "terminal";
			terminalId: string;
	  };

export type ToolCallLocation = {
	path: string;
	line?: number;
};

export type ToolCallUpdate = {
	sessionUpdate: "tool_call" | "tool_call_update";
	toolCallId: string;
	title?: string;
	kind?: ToolCallKind;
	status?: ToolCallStatus;
	content?: ToolCallContent[];
	locations?: ToolCallLocation[];
	rawInput?: Record<string, unknown>;
	rawOutput?: Record<string, unknown>;
};

type ContentChunk = {
	content: SessionContent;
};

type UnknownUpdate = {
	sessionUpdate: "plan" | "available_commands_update" | "config_option_update";
};

type CurrentModeUpdate = {
	currentModeId: string;
};

type SessionInfoUpdate = {
	title?: string | null;
	updatedAt?: string | null;
};

export type SessionUpdate =
	| (ContentChunk & { sessionUpdate: "user_message_chunk" })
	| (ContentChunk & { sessionUpdate: "agent_message_chunk" })
	| (ContentChunk & { sessionUpdate: "agent_thought_chunk" })
	| ToolCallUpdate
	| (CurrentModeUpdate & { sessionUpdate: "current_mode_update" })
	| (SessionInfoUpdate & { sessionUpdate: "session_info_update" })
	| UnknownUpdate;

export type SessionNotification = {
	sessionId: string;
	update: SessionUpdate;
};

export type TerminalOutputEvent = {
	sessionId: string;
	terminalId: string;
	delta: string;
	truncated: boolean;
	output?: string;
	exitStatus?: {
		exitCode?: number | null;
		signal?: string | null;
	} | null;
};

export type PermissionOption = {
	optionId: string;
	label?: string | null;
	description?: string | null;
};

export type PermissionOutcome =
	| { outcome: "selected"; optionId: string }
	| { outcome: "cancelled" };

export type PermissionToolCall = {
	toolCallId?: string;
	name?: string;
	title?: string;
	command?: string;
	args?: string[];
	[key: string]: unknown;
};

export type PermissionRequestNotification = {
	sessionId: string;
	requestId: string;
	options: PermissionOption[];
	toolCall?: PermissionToolCall;
};

export type PermissionResultNotification = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};

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
	return update;
};
