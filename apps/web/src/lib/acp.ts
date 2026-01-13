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

export type SessionUpdate = {
	sessionUpdate: SessionUpdateType;
	content?: SessionContent;
};

export type SessionNotification = {
	sessionId: string;
	update: SessionUpdate;
};

export type SessionTextChunk = {
	role: "user" | "assistant";
	text: string;
};

export const extractTextChunk = (
	notification: SessionNotification,
): SessionTextChunk | null => {
	const { update } = notification;
	if (!update?.content || update.content.type !== "text") {
		return null;
	}

	if (update.sessionUpdate === "user_message_chunk") {
		return { role: "user", text: update.content.text };
	}

	if (update.sessionUpdate === "agent_message_chunk") {
		return { role: "assistant", text: update.content.text };
	}

	return null;
};
