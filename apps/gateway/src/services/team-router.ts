import { randomUUID } from "node:crypto";
import type {
	CreateAgentTeamRpcParams,
	CreateAgentTeamRpcResult,
	GetAgentTeamRpcParams,
	GetAgentTeamRpcResult,
	ListAgentTeamsRpcParams,
	ListAgentTeamsRpcResult,
	RpcRequest,
	RpcResponse,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { logger } from "../lib/logger.js";
import type { CliRecord, CliRegistry } from "./cli-registry.js";

type PendingRpc<T> = {
	socketId: string;
	resolve: (result: T) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
};

const RPC_TIMEOUT = 120000;

export class TeamRouter {
	private pendingRpcs = new Map<string, PendingRpc<unknown>>();

	constructor(private readonly cliRegistry: CliRegistry) {}

	async createAgentTeam(
		params: CreateAgentTeamRpcParams,
		userId: string,
	): Promise<CreateAgentTeamRpcResult> {
		const cli = this.resolveMachineForUser(params.machineId, userId);
		logger.info(
			{ userId, machineId: params.machineId },
			"agent_team_create_rpc_start",
		);
		return this.sendRpc<CreateAgentTeamRpcParams, CreateAgentTeamRpcResult>(
			cli.socket,
			"rpc:agent-team:create",
			params,
		);
	}

	async listAgentTeams(
		params: ListAgentTeamsRpcParams,
		userId: string,
	): Promise<ListAgentTeamsRpcResult> {
		if (params.machineId) {
			const cli = this.resolveMachineForUser(params.machineId, userId);
			return this.sendRpc<ListAgentTeamsRpcParams, ListAgentTeamsRpcResult>(
				cli.socket,
				"rpc:agent-teams:list",
				params,
			);
		}

		const clis = this.cliRegistry.getClisForUser(userId);
		if (clis.length === 0) {
			throw new Error("No CLI connected for this user");
		}

		const results = await Promise.all(
			clis.map((cli) =>
				this.sendRpc<ListAgentTeamsRpcParams, ListAgentTeamsRpcResult>(
					cli.socket,
					"rpc:agent-teams:list",
					{ ...params, machineId: cli.machineId },
				),
			),
		);
		return { teams: results.flatMap((result) => result.teams) };
	}

	async getAgentTeam(
		params: GetAgentTeamRpcParams,
		userId: string,
	): Promise<GetAgentTeamRpcResult> {
		const cli = params.machineId
			? this.resolveMachineForUser(params.machineId, userId)
			: this.cliRegistry.getFirstCliForUser(userId);
		if (!cli) {
			throw new Error("No CLI connected for this user");
		}
		return this.sendRpc<GetAgentTeamRpcParams, GetAgentTeamRpcResult>(
			cli.socket,
			"rpc:agent-team:get",
			{ ...params, machineId: cli.machineId },
		);
	}

	handleRpcResponse(response: RpcResponse<unknown>, sourceSocketId?: string) {
		const pending = this.pendingRpcs.get(response.requestId);
		if (!pending) {
			return;
		}
		if (sourceSocketId && pending.socketId !== sourceSocketId) {
			logger.warn(
				{
					requestId: response.requestId,
					expectedSocketId: pending.socketId,
					sourceSocketId,
				},
				"agent_team_rpc_response_socket_mismatch",
			);
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
				},
				"agent_team_rpc_response_error",
			);
			pending.reject(new Error(response.error.message));
			return;
		}
		pending.resolve(response.result);
	}

	handleCliDisconnect(socketId: string): void {
		for (const [requestId, pending] of this.pendingRpcs) {
			if (pending.socketId !== socketId) {
				continue;
			}
			this.pendingRpcs.delete(requestId);
			clearTimeout(pending.timeout);
			pending.reject(new Error("CLI disconnected"));
		}
	}

	private resolveMachineForUser(machineId: string, userId: string): CliRecord {
		const cli = this.cliRegistry.getCliByMachineIdForUser(machineId, userId);
		if (!cli) {
			throw new Error("Machine not found");
		}
		return cli;
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
				socketId: socket.id,
				resolve: (result) => resolve(result as TResult),
				reject,
				timeout,
			});
			const request: RpcRequest<TParams> = { requestId, params };
			logger.debug({ requestId, event }, "agent_team_rpc_request_sent");
			socket.emit(event, request);
		});
	}
}
