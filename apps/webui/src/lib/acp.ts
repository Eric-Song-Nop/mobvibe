// Re-export ACP types from @mobvibe/shared
export type {
	AgentSessionCapabilities,
	AudioContent,
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
	// Socket event types
	PermissionRequestPayload,
	PermissionResultNotification,
	PermissionToolCall,
	// Plan types
	PlanEntry,
	PlanEntryPriority,
	PlanEntryStatus,
	ResourceLink,
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

export {
	extractAvailableCommandsUpdate,
	extractPlanUpdate,
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	extractToolCallUpdate,
} from "./acp-types";

// Re-export API types used in socket events
export type { ErrorDetail, SessionSummary } from "./api";
