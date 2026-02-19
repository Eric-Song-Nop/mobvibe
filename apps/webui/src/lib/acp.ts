// Re-export ACP types from @mobvibe/shared
export type {
	AgentSessionCapabilities,
	AudioContent,
	AvailableCommand,
	CliStatusPayload,
	ContentBlock,
	GatewayToWebuiEvents,
	ImageContent,
	PermissionDecisionPayload,
	// Permission types
	PermissionOption,
	PermissionOutcome,
	// Socket event types
	PermissionRequestPayload,
	PermissionResultNotification,
	PermissionToolCall,
	// Backwards-compatible aliases (still in use)
	ResourceContent,
	ResourceLinkContent,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	// Session types
	SessionNotification,
	SessionsChangedPayload,
	// Terminal
	TerminalOutputEvent,
	ToolCallContent,
	ToolCallContentPayload,
	ToolCallLocation,
	// Tool types
	ToolCallStatus,
	ToolCallUpdate,
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
