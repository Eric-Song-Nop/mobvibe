// Full SDK re-exports - use SDK types directly
export type {
	AudioContent,
	// Other
	AvailableCommand,
	// Content types
	ContentBlock,
	// Cost & usage types (new in SDK 0.14.x)
	Cost,
	EmbeddedResource,
	ImageContent,
	RequestPermissionOutcome,
	RequestPermissionRequest,
	RequestPermissionResponse,
	ResourceLink,
	// Session config option category (new in SDK 0.14.x)
	SessionConfigOptionCategory,
	// Session types
	SessionNotification,
	SessionUpdate,
	StopReason,
	TerminalExitStatus,
	TextContent,
	ToolCall,
	ToolCallContent,
	ToolCallLocation,
	// Tool types
	ToolCallStatus,
	ToolCallUpdate as SdkToolCallUpdate,
	ToolKind,
	// Usage types (new in SDK 0.14.x)
	Usage,
	UsageUpdate,
} from "@agentclientprotocol/sdk";

// Backwards-compatible aliases (deprecate over time)
import type {
	EmbeddedResource,
	ResourceLink,
	ToolCallUpdate as SdkToolCallUpdate,
	TextContent,
	ToolKind,
} from "@agentclientprotocol/sdk";

/** @deprecated Use `TextContent` from SDK instead */
export type SessionContent = TextContent;

/** @deprecated Use `ToolKind` from SDK instead */
export type ToolCallKind = ToolKind;

/** @deprecated Use `EmbeddedResource` from SDK instead */
export type ResourceContent = EmbeddedResource;

/** @deprecated Use `ResourceLink` from SDK instead */
export type ResourceLinkContent = ResourceLink;

// Keep local types for session update type discriminator values (not exported from SDK)
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
	| "session_info_update"
	| "usage_update";

// Keep local type for broader content payload support (project-specific)
// SDK's Content.content is strictly ContentBlock, but we allow more flexible types
import type { ContentBlock } from "@agentclientprotocol/sdk";
export type ToolCallContentPayload =
	| ContentBlock
	| Record<string, unknown>
	| string;

// ToolCallUpdate with sessionUpdate discriminator (project-specific extension)
// The SDK's ToolCallUpdate doesn't include the sessionUpdate field
export type ToolCallUpdate = SdkToolCallUpdate & {
	sessionUpdate: "tool_call" | "tool_call_update";
};

// Terminal output event (project-specific, not in SDK)
export type TerminalOutputEvent = {
	sessionId: string;
	terminalId: string;
	delta: string;
	truncated: boolean;
	output?: string;
	exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
};

// Permission types (project-specific socket event types)
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

// Permission notification types (project-specific)
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
