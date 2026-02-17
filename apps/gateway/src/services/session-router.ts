import { randomUUID } from "node:crypto";
import type {
	ArchiveSessionParams,
	BulkArchiveSessionsParams,
	CancelSessionParams,
	CloseSessionParams,
	CreateSessionParams,
	DiscoverSessionsRpcParams,
	DiscoverSessionsRpcResult,
	FsEntriesParams,
	FsEntriesResponse,
	FsFileParams,
	FsResourcesParams,
	FsResourcesResponse,
	FsRootsResponse,
	GitFileDiffParams,
	GitFileDiffResponse,
	GitStatusParams,
	GitStatusResponse,
	HostFsEntriesParams,
	HostFsRootsParams,
	HostFsRootsResponse,
	LoadSessionRpcParams,
	PermissionDecisionPayload,
	ReloadSessionRpcParams,
	RpcRequest,
	RpcResponse,
	SendMessageParams,
	SessionEventsParams,
	SessionEventsResponse,
	SessionFsFilePreview,
	SessionSummary,
	SetSessionModelParams,
	SetSessionModeParams,
	StopReason,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { logger } from "../lib/logger.js";
import type { CliRecord, CliRegistry } from "./cli-registry.js";
import {
	createAcpSessionDirect,
	markSessionClosed,
	updateSessionMetadata,
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

	/**
	 * Resolve the CLI that owns a session, scoped to the given user.
	 * Uses a single user-scoped lookup, eliminating the TOCTOU gap of
	 * separate lookup + auth check. Returns generic "Session not found"
	 * for both missing and unauthorized to avoid leaking session existence.
	 */
	private resolveCliForSession(sessionId: string, userId: string): CliRecord {
		const cli = this.cliRegistry.getCliForSessionByUser(sessionId, userId);
		if (!cli) {
			throw new Error("Session not found");
		}
		return cli;
	}

	/**
	 * Resolve the CLI for a machine, scoped to the given user.
	 * Uses a single user-scoped lookup, eliminating the TOCTOU gap of
	 * separate lookup + auth check. Returns generic "Machine not found"
	 * for both missing and unauthorized to avoid leaking machine existence.
	 */
	private resolveMachineForUser(machineId: string, userId: string): CliRecord {
		const cli = this.cliRegistry.getCliByMachineIdForUser(machineId, userId);
		if (!cli) {
			throw new Error("Machine not found");
		}
		return cli;
	}

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
	 * @param userId - User ID for routing to user's machine
	 */
	async createSession(
		params: CreateSessionParams,
		userId: string,
	): Promise<SessionSummary> {
		const targetMachineId = params.machineId;
		const cli = targetMachineId
			? this.resolveMachineForUser(targetMachineId, userId)
			: this.cliRegistry.getFirstCliForUser(userId);
		if (!cli) {
			throw new Error("No CLI connected for this user");
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
	 * @param userId - User ID for authorization
	 */
	async closeSession(
		params: CloseSessionParams,
		userId: string,
	): Promise<{ ok: boolean }> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
		await markSessionClosed(params.sessionId);
		logger.info(
			{ sessionId: params.sessionId, userId },
			"session_close_rpc_complete",
		);

		return result;
	}

	/**
	 * Archive a session: send archive RPC to CLI which closes session, deletes WAL
	 * messages, and marks as archived in local SQLite.
	 * @param params - Session archive parameters
	 * @param userId - User ID for authorization
	 */
	async archiveSession(
		params: CloseSessionParams,
		userId: string,
	): Promise<{ ok: boolean }> {
		logger.info(
			{ sessionId: params.sessionId, userId },
			"session_archive_rpc_start",
		);

		const cli = this.resolveCliForSession(params.sessionId, userId);
		const result = await this.sendRpc<ArchiveSessionParams, { ok: boolean }>(
			cli.socket,
			"rpc:session:archive",
			{
				sessionId: params.sessionId,
			},
		);

		// Immediately remove from registry so the webui sees it gone
		this.cliRegistry.updateSessionsIncremental(cli.socket.id, {
			added: [],
			updated: [],
			removed: [params.sessionId],
		});

		logger.info(
			{ sessionId: params.sessionId, userId },
			"session_archive_rpc_complete",
		);

		return result;
	}

	/**
	 * Archive multiple sessions at once: group by machine and send bulk archive RPC.
	 * @param sessionIds - Session IDs to archive
	 * @param userId - User ID for authorization
	 */
	async bulkArchiveSessions(
		sessionIds: string[],
		userId: string,
	): Promise<{ archivedCount: number }> {
		logger.info(
			{ sessionIds, userId, count: sessionIds.length },
			"session_bulk_archive_start",
		);

		// Group session IDs by their owning CLI machine
		const byMachine = new Map<string, { cli: CliRecord; ids: string[] }>();
		for (const sessionId of sessionIds) {
			try {
				const cli = this.resolveCliForSession(sessionId, userId);
				const key = cli.machineId;
				const entry = byMachine.get(key);
				if (entry) {
					entry.ids.push(sessionId);
				} else {
					byMachine.set(key, { cli, ids: [sessionId] });
				}
			} catch {
				// Session not found in registry — try first CLI for user
				const cli = this.cliRegistry.getFirstCliForUser(userId);
				if (cli) {
					const key = cli.machineId;
					const entry = byMachine.get(key);
					if (entry) {
						entry.ids.push(sessionId);
					} else {
						byMachine.set(key, { cli, ids: [sessionId] });
					}
				}
			}
		}

		let totalArchived = 0;
		const results = await Promise.allSettled(
			Array.from(byMachine.values()).map(async ({ cli, ids }) => {
				const result = await this.sendRpc<
					BulkArchiveSessionsParams,
					{ archivedCount: number }
				>(cli.socket, "rpc:session:archive-all", { sessionIds: ids });

				// Immediately remove from registry so the webui sees them gone
				this.cliRegistry.updateSessionsIncremental(cli.socket.id, {
					added: [],
					updated: [],
					removed: ids,
				});

				return result.archivedCount;
			}),
		);

		for (const result of results) {
			if (result.status === "fulfilled") {
				totalArchived += result.value;
			}
		}

		logger.info(
			{ userId, archivedCount: totalArchived },
			"session_bulk_archive_complete",
		);

		return { archivedCount: totalArchived };
	}

	/**
	 * Cancel a session's current operation.
	 * @param params - Session cancel parameters
	 * @param userId - User ID for authorization
	 */
	async cancelSession(
		params: CancelSessionParams,
		userId: string,
	): Promise<{ ok: boolean }> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async setSessionMode(
		params: SetSessionModeParams,
		userId: string,
	): Promise<SessionSummary> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async setSessionModel(
		params: SetSessionModelParams,
		userId: string,
	): Promise<SessionSummary> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async sendMessage(
		params: SendMessageParams,
		userId: string,
	): Promise<{ stopReason: StopReason }> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async sendPermissionDecision(
		params: PermissionDecisionPayload,
		userId: string,
	): Promise<{ ok: boolean }> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async getFsRoots(
		sessionId: string,
		userId: string,
	): Promise<FsRootsResponse> {
		const cli = this.resolveCliForSession(sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async getFsEntries(
		params: FsEntriesParams,
		userId: string,
	): Promise<FsEntriesResponse> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async getFsFile(
		params: FsFileParams,
		userId: string,
	): Promise<SessionFsFilePreview> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
	 * @param userId - User ID for authorization
	 */
	async getFsResources(
		params: FsResourcesParams,
		userId: string,
	): Promise<FsResourcesResponse> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

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
		userId: string,
	): Promise<HostFsRootsResponse> {
		const cli = this.resolveMachineForUser(params.machineId, userId);

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
		userId: string,
	): Promise<FsEntriesResponse> {
		const cli = this.resolveMachineForUser(params.machineId, userId);

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
	 * Discover sessions persisted by the ACP agent.
	 * @param machineId - Optional machine ID to target specific CLI
	 * @param cwd - Optional working directory filter
	 * @param userId - User ID for authorization
	 * @returns List of discovered sessions and agent capabilities
	 */
	async discoverSessions(
		machineId: string | undefined,
		cwd: string | undefined,
		userId: string,
		cursor?: string,
		backendId?: string,
	): Promise<DiscoverSessionsRpcResult> {
		const cli = machineId
			? this.resolveMachineForUser(machineId, userId)
			: this.cliRegistry.getFirstCliForUser(userId);

		if (!cli) {
			throw new Error("No CLI connected for this user");
		}

		logger.info(
			{ machineId: cli.machineId, cwd, userId, backendId },
			"sessions_discover_rpc_start",
		);

		const params: DiscoverSessionsRpcParams = {
			cwd,
			cursor,
			backendId: backendId ?? "",
		};
		const result = await this.sendRpc<
			DiscoverSessionsRpcParams,
			DiscoverSessionsRpcResult
		>(cli.socket, "rpc:sessions:discover", params);

		logger.info(
			{
				machineId: cli.machineId,
				sessionCount: result.sessions.length,
				capabilities: result.capabilities,
			},
			"sessions_discover_rpc_complete",
		);

		return result;
	}

	/**
	 * Load a historical session from the ACP agent.
	 * This will replay the session's message history.
	 * @param params - Load session parameters
	 * @param userId - User ID for authorization
	 * @returns The loaded session summary
	 */
	async loadSession(
		params: {
			sessionId: string;
			cwd: string;
			backendId: string;
			machineId?: string;
		},
		userId: string,
	): Promise<SessionSummary> {
		const cli = params.machineId
			? this.resolveMachineForUser(params.machineId, userId)
			: this.cliRegistry.getFirstCliForUser(userId);

		if (!cli) {
			throw new Error("No CLI connected for this user");
		}

		logger.info(
			{
				sessionId: params.sessionId,
				machineId: cli.machineId,
				cwd: params.cwd,
				backendId: params.backendId,
				userId,
			},
			"session_load_rpc_start",
		);

		const rpcParams: LoadSessionRpcParams = {
			sessionId: params.sessionId,
			cwd: params.cwd,
			backendId: params.backendId,
		};
		const result = await this.sendRpc<LoadSessionRpcParams, SessionSummary>(
			cli.socket,
			"rpc:session:load",
			rpcParams,
		);

		// Sync session to database if machine is authenticated
		if (cli.userId && cli.machineId) {
			await createAcpSessionDirect({
				userId: cli.userId,
				machineId: cli.machineId,
				sessionId: result.sessionId,
				title: result.title ?? result.sessionId,
				backendId: result.backendId,
				cwd: result.cwd,
			});
		}

		logger.info(
			{ sessionId: result.sessionId, userId },
			"session_load_rpc_complete",
		);

		return result;
	}

	/**
	 * Reload a historical session from the ACP agent.
	 * This will tear down any existing session and replay history again.
	 * @param params - Reload session parameters
	 * @param userId - User ID for authorization
	 * @returns The reloaded session summary
	 */
	async reloadSession(
		params: {
			sessionId: string;
			cwd: string;
			backendId: string;
			machineId?: string;
		},
		userId: string,
	): Promise<SessionSummary> {
		const cli = params.machineId
			? this.resolveMachineForUser(params.machineId, userId)
			: this.cliRegistry.getFirstCliForUser(userId);

		if (!cli) {
			throw new Error("No CLI connected for this user");
		}

		logger.info(
			{
				sessionId: params.sessionId,
				machineId: cli.machineId,
				cwd: params.cwd,
				backendId: params.backendId,
				userId,
			},
			"session_reload_rpc_start",
		);

		const rpcParams: ReloadSessionRpcParams = {
			sessionId: params.sessionId,
			cwd: params.cwd,
			backendId: params.backendId,
		};
		const result = await this.sendRpc<ReloadSessionRpcParams, SessionSummary>(
			cli.socket,
			"rpc:session:reload",
			rpcParams,
		);

		// Sync session to database if machine is authenticated
		if (cli.userId && cli.machineId) {
			await createAcpSessionDirect({
				userId: cli.userId,
				machineId: cli.machineId,
				sessionId: result.sessionId,
				title: result.title ?? result.sessionId,
				backendId: result.backendId,
				cwd: result.cwd,
			});
		}

		logger.info(
			{ sessionId: result.sessionId, userId },
			"session_reload_rpc_complete",
		);

		return result;
	}

	/**
	 * Update session metadata in database.
	 */
	async syncSessionState(
		sessionId: string,
		_state: string,
		title?: string,
		cwd?: string,
	): Promise<void> {
		await updateSessionMetadata({ sessionId, title, cwd });
	}

	/**
	 * Get git status for a session's working directory.
	 * @param sessionId - Session ID
	 * @param userId - User ID for authorization
	 */
	async getGitStatus(
		sessionId: string,
		userId: string,
	): Promise<GitStatusResponse> {
		const cli = this.resolveCliForSession(sessionId, userId);

		logger.debug({ sessionId, userId }, "git_status_rpc_start");

		const result = await this.sendRpc<GitStatusParams, GitStatusResponse>(
			cli.socket,
			"rpc:git:status",
			{ sessionId },
		);

		logger.debug({ sessionId, userId }, "git_status_rpc_complete");
		return result;
	}

	/**
	 * Get git diff for a file in a session's working directory.
	 * @param params - Git file diff parameters
	 * @param userId - User ID for authorization
	 */
	async getGitFileDiff(
		params: GitFileDiffParams,
		userId: string,
	): Promise<GitFileDiffResponse> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

		logger.debug(
			{ sessionId: params.sessionId, path: params.path, userId },
			"git_file_diff_rpc_start",
		);

		const result = await this.sendRpc<GitFileDiffParams, GitFileDiffResponse>(
			cli.socket,
			"rpc:git:fileDiff",
			params,
		);

		logger.debug(
			{ sessionId: params.sessionId, path: params.path, userId },
			"git_file_diff_rpc_complete",
		);
		return result;
	}

	/**
	 * Get session events for backfill.
	 * @param params - Session events parameters
	 * @param userId - User ID for authorization
	 */
	async getSessionEvents(
		params: SessionEventsParams,
		userId: string,
	): Promise<SessionEventsResponse> {
		const cli = this.resolveCliForSession(params.sessionId, userId);

		logger.debug(
			{
				sessionId: params.sessionId,
				revision: params.revision,
				afterSeq: params.afterSeq,
				userId,
			},
			"session_events_rpc_start",
		);

		const result = await this.sendRpc<
			SessionEventsParams,
			SessionEventsResponse
		>(cli.socket, "rpc:session:events", params);

		logger.debug(
			{
				sessionId: params.sessionId,
				revision: params.revision,
				eventCount: result.events.length,
				hasMore: result.hasMore,
				userId,
			},
			"session_events_rpc_complete",
		);
		return result;
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
