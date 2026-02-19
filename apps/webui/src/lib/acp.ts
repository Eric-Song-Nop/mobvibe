// Re-export ACP types from @mobvibe/shared
export type {
	AgentSessionCapabilities,
	AudioContent,
	// Content types
	AvailableCommand,
	CliStatusPayload,
	ContentBlock,
	EmbeddedResource,
	GatewayToWebuiEvents,
	ImageContent,
	PermissionDecisionPayload,
	// Permission types
	PermissionOption,
	PermissionOutcome,
	PermissionRequestNotification,
	// Socket event types
	PermissionRequestPayload,
	PermissionResultNotification,
	PermissionToolCall,
	ResourceContent,
	ResourceLink,
	ResourceLinkContent,
	SessionAttachedPayload,
	// Backwards-compatible aliases
	SessionContent,
	SessionDetachedPayload,
	SessionEvent,
	// Session types
	SessionNotification,
	SessionsChangedPayload,
	SessionUpdate,
	SessionUpdateType,
	StreamErrorPayload,
	// Terminal
	TerminalExitStatus,
	TerminalOutputEvent,
	TextContent,
	ToolCallContent,
	ToolCallContentPayload,
	ToolCallKind,
	ToolCallLocation,
	// Tool types
	ToolCallStatus,
	ToolCallUpdate,
	ToolKind,
	Usage,
	UsageUpdate,
	WebuiToGatewayEvents,
} from "@mobvibe/shared";

// Re-export extraction helper types and functions from acp-types
export type {
	SessionInfoPayload,
	SessionModeUpdate,
	SessionTextChunk,
} from "./acp-types";

export {
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
} from "./acp-types";

// Re-export API types used in socket events
export type { ErrorDetail, SessionSummary } from "./api";
