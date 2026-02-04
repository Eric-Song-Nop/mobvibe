// Re-export ACP types from @mobvibe/core (which re-exports from @mobvibe/shared)
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
	SessionInfoPayload,
	SessionModeUpdate,
	// Session types
	SessionNotification,
	SessionsChangedPayload,
	// Extraction helper types
	SessionTextChunk,
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
	WebuiToGatewayEvents,
} from "@mobvibe/core";

// Re-export extraction functions
export {
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
} from "@mobvibe/core";

// Re-export API types used in socket events
export type { ErrorDetail, SessionSummary } from "./api";
