// ACP types - re-exported from SDK
export type {
	// SDK types (directly from SDK)
	AudioContent,
	AvailableCommand,
	ContentBlock,
	EmbeddedResource,
	ImageContent,
	// Project-specific types
	PermissionOption,
	PermissionOutcome,
	PermissionRequestNotification,
	PermissionResultNotification,
	PermissionToolCall,
	RequestPermissionOutcome,
	RequestPermissionRequest,
	RequestPermissionResponse,
	// Backwards-compatible aliases (deprecated)
	ResourceContent,
	ResourceLink,
	ResourceLinkContent,
	SdkToolCallUpdate,
	SessionContent,
	SessionNotification,
	SessionUpdate,
	SessionUpdateType,
	StopReason,
	TerminalExitStatus,
	TerminalOutputEvent,
	TextContent,
	ToolCall,
	ToolCallContent,
	ToolCallContentPayload,
	ToolCallKind,
	ToolCallLocation,
	ToolCallStatus,
	ToolCallUpdate,
	ToolKind,
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
	// StopReason is now re-exported from SDK via acp.ts
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
