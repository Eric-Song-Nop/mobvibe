// ACP types - re-exported from SDK

export type {
	CryptoKeyPair,
	EncryptedPayload,
	SignedAuthToken,
} from "./crypto/index.js";
// Crypto (E2EE)
export {
	base64ToUint8,
	createSignedToken,
	decryptPayload,
	deriveAuthKeyPair,
	deriveContentKeyPair,
	encryptPayload,
	generateDEK,
	generateMasterSecret,
	initCrypto,
	isEncryptedPayload,
	uint8ToBase64,
	unwrapDEK,
	verifySignedToken,
	wrapDEK,
} from "./crypto/index.js";
export type {
	// SDK types (directly from SDK)
	AgentCapabilities,
	AudioContent,
	AvailableCommand,
	ContentBlock,
	// Cost & usage types (new in SDK 0.14.x)
	Cost,
	EmbeddedResource,
	ImageContent,
	Implementation,
	// Permission types
	PermissionOption,
	PermissionOutcome,
	PermissionResultNotification,
	PermissionToolCall,
	RequestPermissionOutcome,
	RequestPermissionRequest,
	RequestPermissionResponse,
	// Backwards-compatible aliases (still in use)
	ResourceContent,
	ResourceLink,
	ResourceLinkContent,
	// Session config option category (new in SDK 0.14.x)
	SessionConfigOptionCategory,
	// Session info & state types
	SessionModelState,
	SessionModeState,
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
	ToolCallLocation,
	ToolCallStatus,
	ToolCallUpdate,
	ToolKind,
	// Usage types (new in SDK 0.14.x)
	Usage,
	UsageUpdate,
} from "./types/acp.js";
// Agent configuration types
export type {
	MobvibeUserConfig,
	UserAgentConfig,
} from "./types/agent-config.js";
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
	AcpSessionInfo,
	AgentSessionCapabilities,
	DiscoverSessionsParams,
	DiscoverSessionsResult,
	FsEntry,
	FsRoot,
	LoadSessionParams,
	ReloadSessionParams,
	SessionFsFilePreview,
	SessionFsFilePreviewType,
	SessionFsResourceEntry,
	SessionModelOption,
	SessionModeOption,
	SessionSummary,
	SessionsChangedPayload,
} from "./types/session.js";

// Socket event types
export type {
	// HTTP API response types
	AcpBackendsResponse,
	ArchiveSessionParams,
	BulkArchiveSessionsParams,
	CancelSessionParams,
	CancelSessionResponse,
	CliErrorPayload,
	CliRegistrationInfo,
	CliStatusPayload,
	CliToGatewayEvents,
	CloseSessionParams,
	CreateSessionParams,
	CreateSessionResponse,
	DiscoverSessionsRpcParams,
	DiscoverSessionsRpcResult,
	EventsAckPayload,
	FsEntriesParams,
	FsEntriesResponse,
	FsFileParams,
	FsResourcesParams,
	FsResourcesResponse,
	FsRootsResponse,
	GatewayToCliEvents,
	GatewayToWebuiEvents,
	GitFileDiffParams,
	GitFileDiffResponse,
	GitFileStatus,
	GitStatusParams,
	GitStatusResponse,
	HostFsEntriesParams,
	HostFsRootsParams,
	HostFsRootsResponse,
	LoadSessionRpcParams,
	MachinesResponse,
	MessageIdResponse,
	PermissionDecisionPayload,
	PermissionDecisionResponse,
	PermissionRequestPayload,
	ReloadSessionRpcParams,
	RenameSessionParams,
	RpcRequest,
	RpcResponse,
	SendMessageParams,
	SendMessageResult,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	SessionEventKind,
	SessionEventsParams,
	SessionEventsResponse,
	SessionFsFilePreviewResponse,
	SessionsDiscoveredPayload,
	SessionsResponse,
	SetSessionModelParams,
	SetSessionModeParams,
	StreamErrorPayload,
	WebuiToGatewayEvents,
} from "./types/socket-events.js";

// Validation utilities (Zod schemas from SDK)
export { parseSessionNotification } from "./validation/acp-schemas.js";
