import { randomUUID } from "node:crypto";
import type {
	CancelSessionParams,
	CloseSessionParams,
	CreateSessionParams,
	ErrorDetail,
	FsEntriesParams,
	FsEntriesResponse,
	FsFileParams,
	FsResourcesParams,
	FsResourcesResponse,
	FsRootsResponse,
	PermissionDecisionPayload,
	RpcRequest,
	RpcResponse,
	SendMessageParams,
	SessionFsFilePreview,
	SessionSummary,
	SetSessionModelParams,
	SetSessionModeParams,
	StopReason,
} from "@remote-claude/shared";
import type { Socket } from "socket.io";
import type { CliRegistry } from "./cli-registry.js";

type PendingRpc<T> = {
	requestId: string;
	resolve: (result: T) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
};

const RPC_TIMEOUT = 120000; // 2 minutes for long operations like message sending

export class SessionRouter {
	private pendingRpcs = new Map<string, PendingRpc<unknown>>();

	constructor(private readonly cliRegistry: CliRegistry) {}

	handleRpcResponse(response: RpcResponse<unknown>) {
		const pending = this.pendingRpcs.get(response.requestId);
		if (!pending) {
			return;
		}
		this.pendingRpcs.delete(response.requestId);
		clearTimeout(pending.timeout);

		if (response.error) {
			pending.reject(new Error(response.error.message));
		} else {
			pending.resolve(response.result);
		}
	}

	async createSession(params: CreateSessionParams): Promise<SessionSummary> {
		const cli = this.cliRegistry.getFirstCli();
		if (!cli) {
			throw new Error("No CLI connected");
		}
		return this.sendRpc<CreateSessionParams, SessionSummary>(
			cli.socket,
			"rpc:session:create",
			params,
		);
	}

	async closeSession(params: CloseSessionParams): Promise<{ ok: boolean }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<CloseSessionParams, { ok: boolean }>(
			cli.socket,
			"rpc:session:close",
			params,
		);
	}

	async cancelSession(params: CancelSessionParams): Promise<{ ok: boolean }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<CancelSessionParams, { ok: boolean }>(
			cli.socket,
			"rpc:session:cancel",
			params,
		);
	}

	async setSessionMode(params: SetSessionModeParams): Promise<SessionSummary> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<SetSessionModeParams, SessionSummary>(
			cli.socket,
			"rpc:session:mode",
			params,
		);
	}

	async setSessionModel(
		params: SetSessionModelParams,
	): Promise<SessionSummary> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<SetSessionModelParams, SessionSummary>(
			cli.socket,
			"rpc:session:model",
			params,
		);
	}

	async sendMessage(
		params: SendMessageParams,
	): Promise<{ stopReason: StopReason }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<SendMessageParams, { stopReason: StopReason }>(
			cli.socket,
			"rpc:message:send",
			params,
		);
	}

	async sendPermissionDecision(
		params: PermissionDecisionPayload,
	): Promise<{ ok: boolean }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<PermissionDecisionPayload, { ok: boolean }>(
			cli.socket,
			"rpc:permission:decision",
			params,
		);
	}

	async getFsRoots(sessionId: string): Promise<FsRootsResponse> {
		const cli = this.cliRegistry.getCliForSession(sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<{ sessionId: string }, FsRootsResponse>(
			cli.socket,
			"rpc:fs:roots",
			{ sessionId },
		);
	}

	async getFsEntries(params: FsEntriesParams): Promise<FsEntriesResponse> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<FsEntriesParams, FsEntriesResponse>(
			cli.socket,
			"rpc:fs:entries",
			params,
		);
	}

	async getFsFile(params: FsFileParams): Promise<SessionFsFilePreview> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<FsFileParams, SessionFsFilePreview>(
			cli.socket,
			"rpc:fs:file",
			params,
		);
	}

	async getFsResources(
		params: FsResourcesParams,
	): Promise<FsResourcesResponse> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return this.sendRpc<FsResourcesParams, FsResourcesResponse>(
			cli.socket,
			"rpc:fs:resources",
			params,
		);
	}

	private sendRpc<TParams, TResult>(
		socket: Socket,
		event: string,
		params: TParams,
	): Promise<TResult> {
		return new Promise((resolve, reject) => {
			const requestId = randomUUID();
			const timeout = setTimeout(() => {
				this.pendingRpcs.delete(requestId);
				reject(new Error("RPC timeout"));
			}, RPC_TIMEOUT);

			this.pendingRpcs.set(requestId, {
				requestId,
				resolve: resolve as (result: unknown) => void,
				reject,
				timeout,
			});

			const request: RpcRequest<TParams> = { requestId, params };
			socket.emit(event, request);
		});
	}
}
