import type { SignedAuthToken } from "../crypto/types.js";
import type { StopReason } from "./acp.js";
import type {
	SessionFsFilePreview,
	SessionSummary,
	SessionsChangedPayload,
} from "./session.js";
import type {
	ArchiveSessionParams,
	BulkArchiveSessionsParams,
	CancelSessionParams,
	CliErrorPayload,
	CliRegistrationInfo,
	CreateSessionParams,
	DiscoverSessionsRpcParams,
	DiscoverSessionsRpcResult,
	EventsAckPayload,
	FsEntriesParams,
	FsEntriesResponse,
	FsFileParams,
	FsResourcesParams,
	FsResourcesResponse,
	FsRootsResponse,
	GitBlameParams,
	GitBlameResponse,
	GitBranchesForCwdParams,
	GitBranchesForCwdResponse,
	GitBranchesParams,
	GitBranchesResponse,
	GitFileDiffParams,
	GitFileDiffResponse,
	GitFileHistoryParams,
	GitFileHistoryResponse,
	GitGrepParams,
	GitGrepResponse,
	GitLogParams,
	GitLogResponse,
	GitSearchLogParams,
	GitSearchLogResponse,
	GitShowParams,
	GitShowResponse,
	GitStashListParams,
	GitStashListResponse,
	GitStatusExtendedParams,
	GitStatusExtendedResponse,
	GitStatusParams,
	GitStatusResponse,
	HostFsEntriesParams,
	HostFsRootsParams,
	HostFsRootsResponse,
	LoadSessionRpcParams,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	ReloadSessionRpcParams,
	RenameSessionParams,
	RpcRequest,
	RpcResponse,
	SendMessageParams,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	SessionEventsParams,
	SessionEventsResponse,
	SessionsDiscoveredPayload,
	SetSessionModelParams,
	SetSessionModeParams,
} from "./socket-events.js";

export type CliAuthOkPayload = {
	userId: string;
	deviceId: string;
};

export type CliRedirectPayload = {
	instanceId: string;
};

export type CliToGatewayWirePayloadMap = {
	"cli:heartbeat": null;
	"cli:register": CliRegistrationInfo;
	"permission:request": PermissionRequestPayload;
	"permission:result": PermissionDecisionPayload;
	"rpc:response": RpcResponse<unknown>;
	"session:attached": SessionAttachedPayload;
	"session:detached": SessionDetachedPayload;
	"session:event": SessionEvent;
	"sessions:changed": SessionsChangedPayload;
	"sessions:discovered": SessionsDiscoveredPayload;
	"sessions:list": SessionSummary[];
};

export type GatewayToCliWirePayloadMap = {
	"auth-error": CliErrorPayload;
	"auth-ok": CliAuthOkPayload;
	"cli:error": CliErrorPayload;
	"cli:registered": {
		machineId: string;
		userId?: string;
	};
	"events:ack": EventsAckPayload;
	redirect: CliRedirectPayload;
	"rpc:fs:entries": RpcRequest<FsEntriesParams>;
	"rpc:fs:file": RpcRequest<FsFileParams>;
	"rpc:fs:resources": RpcRequest<FsResourcesParams>;
	"rpc:fs:roots": RpcRequest<{ sessionId: string }>;
	"rpc:git:blame": RpcRequest<GitBlameParams>;
	"rpc:git:branches": RpcRequest<GitBranchesParams>;
	"rpc:git:branchesForCwd": RpcRequest<GitBranchesForCwdParams>;
	"rpc:git:fileDiff": RpcRequest<GitFileDiffParams>;
	"rpc:git:fileHistory": RpcRequest<GitFileHistoryParams>;
	"rpc:git:grep": RpcRequest<GitGrepParams>;
	"rpc:git:log": RpcRequest<GitLogParams>;
	"rpc:git:searchLog": RpcRequest<GitSearchLogParams>;
	"rpc:git:show": RpcRequest<GitShowParams>;
	"rpc:git:stashList": RpcRequest<GitStashListParams>;
	"rpc:git:status": RpcRequest<GitStatusParams>;
	"rpc:git:statusExtended": RpcRequest<GitStatusExtendedParams>;
	"rpc:hostfs:entries": RpcRequest<HostFsEntriesParams>;
	"rpc:hostfs:roots": RpcRequest<HostFsRootsParams>;
	"rpc:message:send": RpcRequest<SendMessageParams>;
	"rpc:permission:decision": RpcRequest<PermissionDecisionPayload>;
	"rpc:session:archive": RpcRequest<ArchiveSessionParams>;
	"rpc:session:archive-all": RpcRequest<BulkArchiveSessionsParams>;
	"rpc:session:cancel": RpcRequest<CancelSessionParams>;
	"rpc:session:create": RpcRequest<CreateSessionParams>;
	"rpc:session:events": RpcRequest<SessionEventsParams>;
	"rpc:session:load": RpcRequest<LoadSessionRpcParams>;
	"rpc:session:model": RpcRequest<SetSessionModelParams>;
	"rpc:session:mode": RpcRequest<SetSessionModeParams>;
	"rpc:session:reload": RpcRequest<ReloadSessionRpcParams>;
	"rpc:session:rename": RpcRequest<RenameSessionParams>;
	"rpc:sessions:discover": RpcRequest<DiscoverSessionsRpcParams>;
};

export type CliControlWirePayloadMap = {
	auth: SignedAuthToken;
};

type MessageFromMap<
	TPayloadMap extends Record<string, unknown>,
	TType extends keyof TPayloadMap = keyof TPayloadMap,
> = TType extends string
	? {
			type: TType;
			payload: TPayloadMap[TType];
		}
	: never;

export type CliControlWireMessage = MessageFromMap<CliControlWirePayloadMap>;
export type CliToGatewayWireMessage =
	| CliControlWireMessage
	| MessageFromMap<CliToGatewayWirePayloadMap>;
export type GatewayToCliWireMessage =
	MessageFromMap<GatewayToCliWirePayloadMap>;

export type CliToGatewayWireType = keyof CliToGatewayWirePayloadMap;
export type GatewayToCliWireType = keyof GatewayToCliWirePayloadMap;
export type CliControlWireType = keyof CliControlWirePayloadMap;

export type GatewayRpcResultMap = {
	"rpc:fs:entries": FsEntriesResponse;
	"rpc:fs:file": SessionFsFilePreview;
	"rpc:fs:resources": FsResourcesResponse;
	"rpc:fs:roots": FsRootsResponse;
	"rpc:git:blame": GitBlameResponse;
	"rpc:git:branches": GitBranchesResponse;
	"rpc:git:branchesForCwd": GitBranchesForCwdResponse;
	"rpc:git:fileDiff": GitFileDiffResponse;
	"rpc:git:fileHistory": GitFileHistoryResponse;
	"rpc:git:grep": GitGrepResponse;
	"rpc:git:log": GitLogResponse;
	"rpc:git:searchLog": GitSearchLogResponse;
	"rpc:git:show": GitShowResponse;
	"rpc:git:stashList": GitStashListResponse;
	"rpc:git:status": GitStatusResponse;
	"rpc:git:statusExtended": GitStatusExtendedResponse;
	"rpc:hostfs:entries": FsEntriesResponse;
	"rpc:hostfs:roots": HostFsRootsResponse;
	"rpc:message:send": { stopReason: StopReason };
	"rpc:permission:decision": { ok: boolean };
	"rpc:session:archive": { ok: boolean };
	"rpc:session:archive-all": { archivedCount: number };
	"rpc:session:cancel": { ok: boolean };
	"rpc:session:create": SessionSummary;
	"rpc:session:events": SessionEventsResponse;
	"rpc:session:load": SessionSummary;
	"rpc:session:model": SessionSummary;
	"rpc:session:mode": SessionSummary;
	"rpc:session:reload": SessionSummary;
	"rpc:session:rename": SessionSummary;
	"rpc:sessions:discover": DiscoverSessionsRpcResult;
};
