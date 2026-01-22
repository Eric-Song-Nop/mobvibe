// Re-export ACP types from @remote-claude/core (which re-exports from @remote-claude/shared)
export type {
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
	// Backwards-compatible aliases
	SessionContent,
	SessionInfoPayload,
	SessionModeUpdate,
	// Session types
	SessionNotification,
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
} from "@remote-claude/core";

// Re-export extraction functions
export {
	extractAvailableCommandsUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
} from "@remote-claude/core";

// Re-export API types used in socket events
export type { ErrorDetail, SessionSummary } from "./api";
