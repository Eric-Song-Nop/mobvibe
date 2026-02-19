// Full SDK re-exports - use SDK types directly
export type {
	// Agent & implementation types
	AgentCapabilities,
	AudioContent,
	// Other
	AvailableCommand,
	// Content types
	ContentBlock,
	// Cost & usage types (new in SDK 0.14.x)
	Cost,
	EmbeddedResource,
	ImageContent,
	Implementation,
	RequestPermissionOutcome,
	RequestPermissionRequest,
	RequestPermissionResponse,
	ResourceLink,
	// Session config option category (new in SDK 0.14.x)
	SessionConfigOptionCategory,
	// Session info & state types
	SessionInfo,
	SessionModelState,
	SessionModeState,
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
	ToolKind,
	// Usage types (new in SDK 0.14.x)
	Usage,
	UsageUpdate,
} from "@agentclientprotocol/sdk";

// Backwards-compatible aliases still in use
import type { EmbeddedResource, ResourceLink } from "@agentclientprotocol/sdk";

/** @deprecated Use `EmbeddedResource` from SDK instead */
export type ResourceContent = EmbeddedResource;

/** @deprecated Use `ResourceLink` from SDK instead */
export type ResourceLinkContent = ResourceLink;

// Derive SessionUpdateType from SDK's SessionUpdate discriminated union
// SDK updates will automatically be reflected here - zero manual sync needed
import type { SessionUpdate } from "@agentclientprotocol/sdk";
export type SessionUpdateType = SessionUpdate["sessionUpdate"];

// Keep local type for broader content payload support (project-specific)
// SDK's Content.content is strictly ContentBlock, but we allow more flexible types
import type { ContentBlock } from "@agentclientprotocol/sdk";
export type ToolCallContentPayload =
	| ContentBlock
	| Record<string, unknown>
	| string;

// ToolCallUpdate with sessionUpdate discriminator (project-specific extension)
// The SDK's ToolCallUpdate doesn't include the sessionUpdate field
import type { ToolCallUpdate as SdkToolCallUpdate } from "@agentclientprotocol/sdk";
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

// Permission types - directly from SDK, no project-specific shadow types
import type {
	RequestPermissionOutcome,
	PermissionOption as SdkPermissionOption,
	ToolCallUpdate as SdkPermissionToolCall,
} from "@agentclientprotocol/sdk";

/** Permission option - directly from SDK */
export type PermissionOption = SdkPermissionOption;

/** Permission outcome - directly from SDK */
export type PermissionOutcome = RequestPermissionOutcome;

/** Permission tool call - directly from SDK's ToolCallUpdate */
export type PermissionToolCall = SdkPermissionToolCall;

// Permission result notification (project-specific socket transport wrapper)
export type PermissionResultNotification = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};
