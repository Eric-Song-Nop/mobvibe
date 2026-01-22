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

export const extractAvailableCommandsUpdate = (
	notification: SessionNotification,
): AvailableCommand[] | null => {
	if (notification.update.sessionUpdate !== "available_commands_update") {
		return null;
	}
	return notification.update.availableCommands ?? [];
};

// Socket event types
export type PermissionRequestPayload = {
	sessionId: string;
	requestId: string;
	options: PermissionOption[];
	toolCall?: PermissionToolCall;
};

export type PermissionDecisionPayload = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};

export type StreamErrorPayload = {
	sessionId: string;
	error: ErrorDetail;
};

export type CliStatusPayload = {
	machineId: string;
	connected: boolean;
	hostname?: string;
	sessionCount?: number;
	userId?: string;
};

// Socket.io event interfaces
export interface WebuiToGatewayEvents {
	"subscribe:session": (payload: { sessionId: string }) => void;
	"unsubscribe:session": (payload: { sessionId: string }) => void;
	"permission:decision": (payload: PermissionDecisionPayload) => void;
}

export interface GatewayToWebuiEvents {
	"session:update": (notification: SessionNotification) => void;
	"session:error": (payload: StreamErrorPayload) => void;
	"permission:request": (payload: PermissionRequestPayload) => void;
	"permission:result": (payload: PermissionDecisionPayload) => void;
	"terminal:output": (event: TerminalOutputEvent) => void;
	"cli:status": (payload: CliStatusPayload) => void;
	"sessions:list": (sessions: SessionSummary[]) => void;
}

// API types
export type AcpConnectionState =
	| "idle"
	| "connecting"
	| "ready"
	| "error"
	| "stopped";

export type ErrorScope = "service" | "session" | "stream" | "request";

export type ErrorCode =
	| "ACP_CONNECT_FAILED"
	| "ACP_PROCESS_EXITED"
	| "ACP_CONNECTION_CLOSED"
	| "ACP_PROTOCOL_MISMATCH"
	| "SESSION_NOT_FOUND"
	| "SESSION_NOT_READY"
	| "CAPABILITY_NOT_SUPPORTED"
	| "REQUEST_VALIDATION_FAILED"
	| "STREAM_DISCONNECTED"
	| "INTERNAL_ERROR";

export type ErrorDetail = {
	code: ErrorCode;
	message: string;
	retryable: boolean;
	scope: ErrorScope;
	detail?: string;
};

export type AcpBackendSummary = {
	backendId: string;
	backendLabel: string;
};

export type AcpBackendsResponse = {
	defaultBackendId: string;
	backends: AcpBackendSummary[];
};

export type FsRoot = {
	name: string;
	path: string;
};

export type FsRootsResponse = {
	homePath: string;
	roots: FsRoot[];
};

export type FsEntry = {
	name: string;
	path: string;
	type: "directory" | "file";
	hidden: boolean;
};

export type FsEntriesResponse = {
	path: string;
	entries: FsEntry[];
};

export type SessionFsRoot = {
	name: string;
	path: string;
};

export type SessionFsRootsResponse = {
	root: SessionFsRoot;
};

export type SessionFsFilePreviewType = "code" | "image";

export type SessionFsFilePreviewResponse = {
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

export type SessionFsResourcesResponse = {
	rootPath: string;
	entries: SessionFsResourceEntry[];
};

export type SessionState = AcpConnectionState;

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
	state: SessionState;
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
};

export type SessionsResponse = {
	sessions: SessionSummary[];
};

export type CreateSessionResponse = SessionSummary;

export type StopReason =
	| "end_turn"
	| "max_tokens"
	| "max_turn_requests"
	| "refusal"
	| "cancelled";

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
