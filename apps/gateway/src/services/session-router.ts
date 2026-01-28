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
	HostFsEntriesParams,
	HostFsRootsParams,
	HostFsRootsResponse,
	PermissionDecisionPayload,
	RpcRequest,
	RpcResponse,
	SendMessageParams,
	SessionFsFilePreview,
	SessionSummary,
	SetSessionModelParams,
	SetSessionModeParams,
	StopReason,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "./cli-registry.js";
import {
	closeAcpSession,
	createAcpSessionDirect,
	updateAcpSessionState,
} from "./db-service.js";

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
			logger.warn(
				{
					requestId: response.requestId,
					code: response.error.code,
					scope: response.error.scope,
					retryable: response.error.retryable,
					detail: response.error.detail,
				},
				"rpc_response_error",
			);
			const error = new Error(response.error.message);
			if (response.error.detail) {
				error.cause = response.error.detail;
			}
			pending.reject(error);
		} else {
			logger.debug({ requestId: response.requestId }, "rpc_response_success");
			pending.resolve(response.result);
		}
	}

	/**
	 * Create a new session.
	 * @param params - Session creation parameters
	 * @param userId - Optional user ID for routing to user's machine
	 */
	async createSession(
		params: CreateSessionParams,
		userId?: string,
	): Promise<SessionSummary> {
		const targetMachineId = params.machineId;
		const cli = targetMachineId
			? this.cliRegistry.getCliByMachineId(targetMachineId)
			: this.cliRegistry.getFirstCliForUser(userId);
		if (!cli) {
			throw new Error(
				targetMachineId
					? "No CLI connected for this machine"
					: userId
						? "No CLI connected for this user"
						: "No CLI connected",
			);
		}
		if (
			targetMachineId &&
			userId &&
			!this.cliRegistry.isMachineOwnedByUser(targetMachineId, userId)
		) {
			throw new Error("Not authorized to access this machine");
		}

		logger.info(
			{ userId, machineId: cli.machineId, backendId: params.backendId },
			"session_create_rpc_start",
		);

		const rpcParams: CreateSessionParams = {
			cwd: params.cwd,
			title: params.title,
			backendId: params.backendId,
		};
		const result = await this.sendRpc<CreateSessionParams, SessionSummary>(
			cli.socket,
			"rpc:session:create",
			rpcParams,
		);

		// Sync session to database if machine is authenticated
		if (cli.userId && cli.machineId) {
			await createAcpSessionDirect({
				userId: cli.userId,
				machineId: cli.machineId,
				sessionId: result.sessionId,
				title: result.title ?? `Session ${result.sessionId.slice(0, 8)}`,
				backendId: result.backendId,
				cwd: result.cwd,
			});
		}

		logger.info(
			{ sessionId: result.sessionId, userId },
			"session_create_rpc_complete",
		);

		return result;
	}

	/**
	 * Close a session.
	 * @param params - Session close parameters
	 * @param userId - Optional user ID for authorization
	 */
	async closeSession(
		params: CloseSessionParams,
		userId?: string,
	): Promise<{ ok: boolean }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		// Authorization check if userId provided
		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to close this session");
		}

		logger.info(
			{ sessionId: params.sessionId, userId },
			"session_close_rpc_start",
		);

		const result = await this.sendRpc<CloseSessionParams, { ok: boolean }>(
			cli.socket,
			"rpc:session:close",
			params,
		);

		// Sync to database
		await closeAcpSession(params.sessionId);
		logger.info(
			{ sessionId: params.sessionId, userId },
			"session_close_rpc_complete",
		);

		return result;
	}

	/**
	 * Cancel a session's current operation.
	 * @param params - Session cancel parameters
	 * @param userId - Optional user ID for authorization
	 */
	async cancelSession(
		params: CancelSessionParams,
		userId?: string,
	): Promise<{ ok: boolean }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		// Authorization check if userId provided
		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to cancel this session");
		}

		logger.info(
			{ sessionId: params.sessionId, userId },
			"session_cancel_rpc_start",
		);

		const result = await this.sendRpc<CancelSessionParams, { ok: boolean }>(
			cli.socket,
			"rpc:session:cancel",
			params,
		);

		logger.info(
			{ sessionId: params.sessionId, userId },
			"session_cancel_rpc_complete",
		);

		return result;
	}

	/**
	 * Set session mode.
	 * @param params - Session mode parameters
	 * @param userId - Optional user ID for authorization
	 */
	async setSessionMode(
		params: SetSessionModeParams,
		userId?: string,
	): Promise<SessionSummary> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to modify this session");
		}

		logger.info(
			{ sessionId: params.sessionId, modeId: params.modeId, userId },
			"session_mode_rpc_start",
		);

		const result = await this.sendRpc<SetSessionModeParams, SessionSummary>(
			cli.socket,
			"rpc:session:mode",
			params,
		);

		logger.info(
			{ sessionId: params.sessionId, modeId: params.modeId, userId },
			"session_mode_rpc_complete",
		);

		return result;
	}

	/**
	 * Set session model.
	 * @param params - Session model parameters
	 * @param userId - Optional user ID for authorization
	 */
	async setSessionModel(
		params: SetSessionModelParams,
		userId?: string,
	): Promise<SessionSummary> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to modify this session");
		}

		logger.info(
			{ sessionId: params.sessionId, modelId: params.modelId, userId },
			"session_model_rpc_start",
		);

		const result = await this.sendRpc<SetSessionModelParams, SessionSummary>(
			cli.socket,
			"rpc:session:model",
			params,
		);

		logger.info(
			{ sessionId: params.sessionId, modelId: params.modelId, userId },
			"session_model_rpc_complete",
		);

		return result;
	}

	/**
	 * Send a message to a session.
	 * @param params - Message send parameters
	 * @param userId - Optional user ID for authorization
	 */
	async sendMessage(
		params: SendMessageParams,
		userId?: string,
	): Promise<{ stopReason: StopReason }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to send messages to this session");
		}

		logger.info(
			{ sessionId: params.sessionId, userId },
			"message_send_requested",
		);
		logger.debug(
			{ sessionId: params.sessionId, userId },
			"message_send_rpc_start",
		);

		return this.sendRpc<SendMessageParams, { stopReason: StopReason }>(
			cli.socket,
			"rpc:message:send",
			params,
		);
	}

	/**
	 * Send a permission decision for a session.
	 * @param params - Permission decision parameters
	 * @param userId - Optional user ID for authorization
	 */
	async sendPermissionDecision(
		params: PermissionDecisionPayload,
		userId?: string,
	): Promise<{ ok: boolean }> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error(
				"Not authorized to make permission decisions for this session",
			);
		}

		logger.info(
			{ sessionId: params.sessionId, requestId: params.requestId, userId },
			"permission_decision_rpc_start",
		);

		const result = await this.sendRpc<
			PermissionDecisionPayload,
			{ ok: boolean }
		>(cli.socket, "rpc:permission:decision", params);

		logger.info(
			{ sessionId: params.sessionId, requestId: params.requestId, userId },
			"permission_decision_rpc_complete",
		);

		return result;
	}

	/**
	 * Get file system roots for a session.
	 * @param sessionId - Session ID
	 * @param userId - Optional user ID for authorization
	 */
	async getFsRoots(
		sessionId: string,
		userId?: string,
	): Promise<FsRootsResponse> {
		const cli = this.cliRegistry.getCliForSession(sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (userId && !this.cliRegistry.isSessionOwnedByUser(sessionId, userId)) {
			throw new Error("Not authorized to access this session");
		}

		logger.debug({ sessionId, userId }, "fs_roots_rpc_start");

		const result = await this.sendRpc<{ sessionId: string }, FsRootsResponse>(
			cli.socket,
			"rpc:fs:roots",
			{ sessionId },
		);

		logger.debug({ sessionId, userId }, "fs_roots_rpc_complete");
		return result;
	}

	/**
	 * Get file system entries for a session.
	 * @param params - File system entries parameters
	 * @param userId - Optional user ID for authorization
	 */
	async getFsEntries(
		params: FsEntriesParams,
		userId?: string,
	): Promise<FsEntriesResponse> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to access this session");
		}

		logger.debug(
			{ sessionId: params.sessionId, userId },
			"fs_entries_rpc_start",
		);

		const result = await this.sendRpc<FsEntriesParams, FsEntriesResponse>(
			cli.socket,
			"rpc:fs:entries",
			params,
		);

		logger.debug(
			{ sessionId: params.sessionId, userId },
			"fs_entries_rpc_complete",
		);

		return result;
	}

	/**
	 * Get file content for a session.
	 * @param params - File parameters
	 * @param userId - Optional user ID for authorization
	 */
	async getFsFile(
		params: FsFileParams,
		userId?: string,
	): Promise<SessionFsFilePreview> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to access this session");
		}

		logger.debug({ sessionId: params.sessionId, userId }, "fs_file_rpc_start");

		const result = await this.sendRpc<FsFileParams, SessionFsFilePreview>(
			cli.socket,
			"rpc:fs:file",
			params,
		);

		logger.debug(
			{ sessionId: params.sessionId, userId },
			"fs_file_rpc_complete",
		);

		return result;
	}

	/**
	 * Get resources for a session.
	 * @param params - Resources parameters
	 * @param userId - Optional user ID for authorization
	 */
	async getFsResources(
		params: FsResourcesParams,
		userId?: string,
	): Promise<FsResourcesResponse> {
		const cli = this.cliRegistry.getCliForSession(params.sessionId);
		if (!cli) {
			throw new Error("Session not found");
		}

		if (
			userId &&
			!this.cliRegistry.isSessionOwnedByUser(params.sessionId, userId)
		) {
			throw new Error("Not authorized to access this session");
		}

		logger.debug(
			{ sessionId: params.sessionId, userId },
			"fs_resources_rpc_start",
		);

		const result = await this.sendRpc<FsResourcesParams, FsResourcesResponse>(
			cli.socket,
			"rpc:fs:resources",
			params,
		);

		logger.debug(
			{ sessionId: params.sessionId, userId },
			"fs_resources_rpc_complete",
		);

		return result;
	}

	/**
	 * Get host file system roots for a machine.
	 */
	async getHostFsRoots(
		params: HostFsRootsParams,
		userId?: string,
	): Promise<HostFsRootsResponse> {
		const cli = this.cliRegistry.getCliByMachineId(params.machineId);
		if (!cli) {
			throw new Error("Machine not found");
		}
		if (
			userId &&
			!this.cliRegistry.isMachineOwnedByUser(params.machineId, userId)
		) {
			throw new Error("Not authorized to access this machine");
		}

		logger.debug(
			{ machineId: params.machineId, userId },
			"host_fs_roots_rpc_start",
		);

		const result = await this.sendRpc<HostFsRootsParams, HostFsRootsResponse>(
			cli.socket,
			"rpc:hostfs:roots",
			params,
		);

		logger.debug(
			{ machineId: params.machineId, userId },
			"host_fs_roots_rpc_complete",
		);
		return result;
	}

	/**
	 * Get host file system entries for a machine.
	 */
	async getHostFsEntries(
		params: HostFsEntriesParams,
		userId?: string,
	): Promise<FsEntriesResponse> {
		const cli = this.cliRegistry.getCliByMachineId(params.machineId);
		if (!cli) {
			throw new Error("Machine not found");
		}
		if (
			userId &&
			!this.cliRegistry.isMachineOwnedByUser(params.machineId, userId)
		) {
			throw new Error("Not authorized to access this machine");
		}

		logger.debug(
			{ machineId: params.machineId, userId, path: params.path },
			"host_fs_entries_rpc_start",
		);

		const result = await this.sendRpc<HostFsEntriesParams, FsEntriesResponse>(
			cli.socket,
			"rpc:hostfs:entries",
			params,
		);

		logger.debug(
			{ machineId: params.machineId, userId, path: params.path },
			"host_fs_entries_rpc_complete",
		);
		return result;
	}

	/**
	 * Update session state in database (called from session update events).
	 */
	async syncSessionState(
		sessionId: string,
		state: string,
		title?: string,
		cwd?: string,
	): Promise<void> {
		await updateAcpSessionState({ sessionId, state, title, cwd });
	}

	private sendRpc<TParams, TResult>(
		socket: Socket,
		event: string,
		params: TParams,
	): Promise<TResult> {
		return new Promise((resolve, reject) => {
			const requestId = randomUUID();
			const start = process.hrtime.bigint();
			const timeout = setTimeout(() => {
				this.pendingRpcs.delete(requestId);
				const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
				logger.warn(
					{ requestId, event, timeoutMs: RPC_TIMEOUT, durationMs },
					"rpc_timeout",
				);
				reject(new Error("RPC timeout"));
			}, RPC_TIMEOUT);

			this.pendingRpcs.set(requestId, {
				requestId,
				resolve: (result) => {
					const durationMs =
						Number(process.hrtime.bigint() - start) / 1_000_000;
					logger.debug(
						{ requestId, event, durationMs },
						"rpc_response_resolved",
					);
					resolve(result as TResult);
				},
				reject: (error) => {
					const durationMs =
						Number(process.hrtime.bigint() - start) / 1_000_000;
					logger.warn(
						{ requestId, event, durationMs, err: error },
						"rpc_response_rejected",
					);
					reject(error as Error);
				},
				timeout,
			});

			const request: RpcRequest<TParams> = { requestId, params };
			logger.debug({ requestId, event }, "rpc_request_sent");
			socket.emit(event, request);
		});
	}
}
