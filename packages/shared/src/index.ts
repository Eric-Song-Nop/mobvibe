// ACP types
export type {
	AudioContent,
	AvailableCommand,
	ContentBlock,
	ImageContent,
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
	ResourceContent,
	ResourceLinkContent,
	SessionContent,
	SessionNotification,
	SessionUpdate,
	SessionUpdateType,
	TerminalExitStatus,
	TerminalOutputEvent,
	ToolCallContent,
	ToolCallContentPayload,
	ToolCallKind,
	ToolCallLocation,
	ToolCallStatus,
	ToolCallUpdate,
} from "./types/acp.js";

// Error types
export type {
	ErrorCode,
	ErrorDetail,
	ErrorDetailInput,
	ErrorScope,
} from "./types/errors.js";

export {
	AppError,
	createErrorDetail,
	createInternalError,
	isErrorDetail,
	isProtocolMismatch,
	withScope,
} from "./types/errors.js";

// Session types
export type {
	AcpBackendId,
	AcpBackendSummary,
	AcpConnectionState,
	FsEntry,
	FsRoot,
	SessionFsFilePreview,
	SessionFsFilePreviewType,
	SessionFsResourceEntry,
	SessionModelOption,
	SessionModeOption,
	SessionSummary,
	StopReason,
} from "./types/session.js";

// Socket event types
export type {
	CancelSessionParams,
	CliErrorPayload,
	CliRegistrationInfo,
	CliStatusPayload,
	CliToGatewayEvents,
	CloseSessionParams,
	CreateSessionParams,
	FsEntriesParams,
	FsEntriesResponse,
	FsFileParams,
	FsResourcesParams,
	FsResourcesResponse,
	FsRootsResponse,
	GatewayToCliEvents,
	GatewayToWebuiEvents,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	RpcRequest,
	RpcResponse,
	SendMessageParams,
	SendMessageResult,
	SetSessionModelParams,
	SetSessionModeParams,
	StreamErrorPayload,
	WebuiToGatewayEvents,
} from "./types/socket-events.js";
