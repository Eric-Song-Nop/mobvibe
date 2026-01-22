export type AvailableCommand = {
	name: string;
	description: string;
	input?: { hint: string } | null;
	_meta?: Record<string, unknown> | null;
};

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

export type ImageContent = {
	type: "image";
	data: string;
	mimeType: string;
	uri?: string;
};

export type AudioContent = {
	type: "audio";
	data: string;
	mimeType: string;
};

export type ResourceContent = {
	type: "resource";
	resource: {
		uri: string;
		mimeType?: string;
		text?: string;
		blob?: string;
	};
};

export type ResourceLinkContent = {
	type: "resource_link";
	uri: string;
	name: string;
	mimeType?: string;
	title?: string;
	description?: string;
	size?: number;
};

export type ContentBlock =
	| SessionContent
	| ImageContent
	| AudioContent
	| ResourceContent
	| ResourceLinkContent;

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

export type ToolCallContentPayload =
	| ContentBlock
	| Record<string, unknown>
	| string;

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
	content: ContentBlock;
};

type AvailableCommandsUpdate = {
	sessionUpdate: "available_commands_update";
	availableCommands: AvailableCommand[];
};

type UnknownUpdate = {
	sessionUpdate: "plan" | "config_option_update";
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
	| AvailableCommandsUpdate
	| UnknownUpdate;

export type SessionNotification = {
	sessionId: string;
	update: SessionUpdate;
};

export type TerminalExitStatus = {
	exitCode?: number | null;
	signal?: string | null;
};

export type TerminalOutputEvent = {
	sessionId: string;
	terminalId: string;
	delta: string;
	truncated: boolean;
	output?: string;
	exitStatus?: TerminalExitStatus | null;
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
	name?: string | null;
	title?: string | null;
	command?: string | null;
	args?: string[] | null;
	[key: string]: unknown;
};
