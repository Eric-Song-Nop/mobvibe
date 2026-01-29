import type {
	ContentBlock,
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
	SessionNotification,
	StopReason,
	TerminalOutputEvent,
} from "./acp.js";
import type { ErrorDetail } from "./errors.js";
import type {
	AcpBackendId,
	AcpBackendSummary,
	FsEntry,
	FsRoot,
	SessionFsResourceEntry,
	SessionSummary,
	SessionsChangedPayload,
} from "./session.js";

// Permission request payload sent through Socket.io
export type PermissionRequestPayload = {
	sessionId: string;
	requestId: string;
	options: PermissionOption[];
	toolCall?: PermissionToolCall;
};

// Permission decision payload sent through Socket.io
export type PermissionDecisionPayload = {
	sessionId: string;
	requestId: string;
	outcome: PermissionOutcome;
};

// CLI registration info
export type CliRegistrationInfo = {
	machineId: string;
	hostname: string;
	version?: string;
	backends?: AcpBackendSummary[];
	defaultBackendId?: string;
};

// CLI error payload (sent when auth fails)
export type CliErrorPayload = {
	code: string;
	message: string;
};

// CLI status update
export type CliStatusPayload = {
	machineId: string;
	connected: boolean;
	hostname?: string;
	sessionCount?: number;
	/** User ID (only present when auth is enabled) */
	userId?: string;
};

// Stream error event
export type StreamErrorPayload = {
	sessionId: string;
	error: ErrorDetail;
};

// RPC request wrapper
export type RpcRequest<TParams> = {
	requestId: string;
	params: TParams;
};

// RPC response wrapper
export type RpcResponse<TResult> = {
	requestId: string;
	result?: TResult;
	error?: ErrorDetail;
};

// Create session RPC params
export type CreateSessionParams = {
	cwd?: string;
	title?: string;
	backendId?: AcpBackendId;
	machineId?: string;
};

// Send message RPC params
export type SendMessageParams = {
	sessionId: string;
	prompt: ContentBlock[];
};

// Send message RPC result
export type SendMessageResult = {
	stopReason: StopReason;
};

// Close session RPC params
export type CloseSessionParams = {
	sessionId: string;
};

// Cancel session RPC params
export type CancelSessionParams = {
	sessionId: string;
};

// Set session mode RPC params
export type SetSessionModeParams = {
	sessionId: string;
	modeId: string;
};

// Set session model RPC params
export type SetSessionModelParams = {
	sessionId: string;
	modelId: string;
};

// File system RPC params
export type FsEntriesParams = {
	sessionId: string;
	path?: string;
};

// Host file system RPC params
export type HostFsRootsParams = {
	machineId: string;
};

export type HostFsEntriesParams = {
	machineId: string;
	path: string;
};

export type FsFileParams = {
	sessionId: string;
	path: string;
};

export type FsResourcesParams = {
	sessionId: string;
};

// File system RPC responses
export type FsRootsResponse = {
	root: FsRoot;
};

export type FsEntriesResponse = {
	path: string;
	entries: FsEntry[];
};

export type FsResourcesResponse = {
	rootPath: string;
	entries: SessionFsResourceEntry[];
};

export type HostFsRootsResponse = {
	homePath: string;
	roots: FsRoot[];
};

// CLI -> Gateway events
export interface CliToGatewayEvents {
	"cli:register": (info: CliRegistrationInfo) => void;
	"cli:heartbeat": () => void;
	"session:update": (notification: SessionNotification) => void;
	"session:error": (payload: StreamErrorPayload) => void;
	"permission:request": (payload: PermissionRequestPayload) => void;
	"permission:result": (payload: PermissionDecisionPayload) => void;
	"terminal:output": (event: TerminalOutputEvent) => void;
	"sessions:list": (sessions: SessionSummary[]) => void;
	"sessions:changed": (payload: SessionsChangedPayload) => void;

	// RPC responses
	"rpc:response": (response: RpcResponse<unknown>) => void;
}

// Gateway -> CLI events
export interface GatewayToCliEvents {
	"cli:registered": (info: { machineId: string; userId?: string }) => void;
	"cli:error": (payload: CliErrorPayload) => void;

	// RPC requests
	"rpc:session:create": (request: RpcRequest<CreateSessionParams>) => void;
	"rpc:session:close": (request: RpcRequest<CloseSessionParams>) => void;
	"rpc:session:cancel": (request: RpcRequest<CancelSessionParams>) => void;
	"rpc:session:mode": (request: RpcRequest<SetSessionModeParams>) => void;
	"rpc:session:model": (request: RpcRequest<SetSessionModelParams>) => void;
	"rpc:message:send": (request: RpcRequest<SendMessageParams>) => void;
	"rpc:permission:decision": (
		request: RpcRequest<PermissionDecisionPayload>,
	) => void;

	// File system RPC requests
	"rpc:fs:roots": (request: RpcRequest<{ sessionId: string }>) => void;
	"rpc:fs:entries": (request: RpcRequest<FsEntriesParams>) => void;
	"rpc:fs:file": (request: RpcRequest<FsFileParams>) => void;
	"rpc:fs:resources": (request: RpcRequest<FsResourcesParams>) => void;
	"rpc:hostfs:roots": (request: RpcRequest<HostFsRootsParams>) => void;
	"rpc:hostfs:entries": (request: RpcRequest<HostFsEntriesParams>) => void;
}

// Webui -> Gateway events
export interface WebuiToGatewayEvents {
	"subscribe:session": (payload: { sessionId: string }) => void;
	"unsubscribe:session": (payload: { sessionId: string }) => void;
	"permission:decision": (payload: PermissionDecisionPayload) => void;
}

// Gateway -> Webui events
export interface GatewayToWebuiEvents {
	"session:update": (notification: SessionNotification) => void;
	"session:error": (payload: StreamErrorPayload) => void;
	"permission:request": (payload: PermissionRequestPayload) => void;
	"permission:result": (payload: PermissionDecisionPayload) => void;
	"terminal:output": (event: TerminalOutputEvent) => void;
	"cli:status": (payload: CliStatusPayload) => void;
	"sessions:list": (sessions: SessionSummary[]) => void;
	"sessions:changed": (payload: SessionsChangedPayload) => void;
}
