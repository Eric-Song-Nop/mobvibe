import { randomUUID } from "node:crypto";
import {
	type AgentTeamListResult,
	type AgentTeamSummary,
	AppError,
	type CreateAgentTeamRpcParams,
	type CreateAgentTeamRpcResult,
	createErrorDetail,
	createInternalError,
	type GetAgentTeamRpcParams,
	type GetAgentTeamRpcResult,
	type ListAgentTeamsRpcParams,
	type ListAgentTeamsRpcResult,
	type PlaceTeamRelayPeerResult,
	parsePlaceTeamRelayPeerParams,
	parsePlaceTeamRelayPeerResult,
	parseResolveTeamRelayPeerParams,
	parseSendTeamRelayParams,
	parseTeamRelayExecuteRpcResult,
	type ResolveTeamRelayPeerResult,
	type RpcRequest,
	type RpcResponse,
	type SendTeamRelayResult,
	type SessionSummary,
	TEAM_RELAY_GATEWAY_RPC_TIMEOUT_MS,
	type TeamRelayExecuteRpcParams,
	type TeamRelayExecuteRpcResult,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { logger } from "../lib/logger.js";
import type { CliRecord, CliRegistry } from "./cli-registry.js";
import { toRpcAppError } from "./rpc-errors.js";

type PendingRpc<T> = {
	socketId: string;
	resolve: (result: T) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
};

const canonicalizeTeamMachine = (
	team: AgentTeamSummary,
	machineId: string,
): AgentTeamSummary => ({ ...team, machineId });

const canonicalizeSessionMachine = (
	session: SessionSummary,
	machineId: string,
): SessionSummary => ({ ...session, machineId });

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
		const result = await this.sendRpc<
			CreateAgentTeamRpcParams,
			CreateAgentTeamRpcResult
		>(cli.socket, "rpc:agent-team:create", params);
		return {
			...result,
			team: canonicalizeTeamMachine(result.team, cli.machineId),
			...(result.leaderSession
				? {
						leaderSession: canonicalizeSessionMachine(
							result.leaderSession,
							cli.machineId,
						),
					}
				: {}),
		};
	}

	async listAgentTeams(
		params: ListAgentTeamsRpcParams,
		userId: string,
	): Promise<AgentTeamListResult> {
		if (params.machineId) {
			const cli = this.resolveMachineForUser(params.machineId, userId);
			const result = await this.sendRpc<
				ListAgentTeamsRpcParams,
				ListAgentTeamsRpcResult
			>(cli.socket, "rpc:agent-teams:list", params);
			if (
				this.cliRegistry.getCliByMachineIdForUser(cli.machineId, userId) !== cli
			) {
				return {
					teams: [],
					coveredLeaderMachineIds: [],
				};
			}
			return {
				teams: result.teams.map((team) =>
					canonicalizeTeamMachine(team, cli.machineId),
				),
				coveredLeaderMachineIds: [cli.machineId],
			};
		}

		const clis = this.cliRegistry.getClisForUser(userId);
		if (clis.length === 0) {
			throw new Error("No CLI connected for this user");
		}

		const results = await Promise.allSettled(
			clis.map(async (cli) => ({
				cli,
				result: await this.sendRpc<
					ListAgentTeamsRpcParams,
					ListAgentTeamsRpcResult
				>(cli.socket, "rpc:agent-teams:list", {
					...params,
					machineId: cli.machineId,
				}),
			})),
		);
		const successful = results.flatMap((result) => {
			if (result.status !== "fulfilled") {
				return [];
			}
			const { cli } = result.value;
			const currentCli = this.cliRegistry.getCliByMachineIdForUser(
				cli.machineId,
				userId,
			);
			return currentCli === cli ? [result.value] : [];
		});
		if (successful.length === 0) {
			const firstFailure = results.find(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			if (firstFailure) {
				throw firstFailure.reason;
			}
		}
		return {
			teams: successful.flatMap(({ cli, result }) =>
				result.teams.map((team) =>
					canonicalizeTeamMachine(team, cli.machineId),
				),
			),
			coveredLeaderMachineIds: successful.map(({ cli }) => cli.machineId),
		};
	}

	async getAgentTeam(
		params: GetAgentTeamRpcParams,
		userId: string,
	): Promise<GetAgentTeamRpcResult> {
		if (params.machineId) {
			const cli = this.resolveMachineForUser(params.machineId, userId);
			const result = await this.sendRpc<
				GetAgentTeamRpcParams,
				GetAgentTeamRpcResult
			>(cli.socket, "rpc:agent-team:get", {
				...params,
				machineId: cli.machineId,
			});
			if (
				this.cliRegistry.getCliByMachineIdForUser(cli.machineId, userId) !== cli
			) {
				return {};
			}
			return result.team
				? { team: canonicalizeTeamMachine(result.team, cli.machineId) }
				: {};
		}

		const clis = this.cliRegistry.getClisForUser(userId);
		if (clis.length === 0) {
			throw new Error("No CLI connected for this user");
		}

		const results = await Promise.allSettled(
			clis.map(async (cli) => ({
				cli,
				result: await this.sendRpc<
					GetAgentTeamRpcParams,
					GetAgentTeamRpcResult
				>(cli.socket, "rpc:agent-team:get", {
					...params,
					machineId: cli.machineId,
				}),
			})),
		);
		const successful = results.flatMap((result) => {
			if (result.status !== "fulfilled") {
				return [];
			}
			const { cli } = result.value;
			return this.cliRegistry.getCliByMachineIdForUser(
				cli.machineId,
				userId,
			) === cli
				? [result.value]
				: [];
		});
		const matches = successful.flatMap(({ cli, result }) =>
			result.team ? [{ cli, team: result.team }] : [],
		);
		if (matches.length > 1) {
			throw new AppError(
				createErrorDetail({
					code: "AGENT_TEAM_ID_COLLISION",
					message: "Agent Team identity collision detected",
					retryable: false,
					scope: "service",
				}),
				409,
			);
		}
		const match = matches[0];
		if (match) {
			return {
				team: canonicalizeTeamMachine(match.team, match.cli.machineId),
			};
		}

		const firstFailure = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (firstFailure) {
			throw firstFailure.reason;
		}
		if (successful.length !== clis.length) {
			throw new Error("CLI registration changed during Agent Team lookup");
		}
		return {};
	}

	async resolveRelayPeer(
		rawParams: unknown,
		source: CliRecord,
	): Promise<ResolveTeamRelayPeerResult> {
		const params = this.parseResolveRelayParams(rawParams);
		const target = this.resolveRelayTarget(params.targetMachineId, source);
		return {
			targetMachineId: target.machineId,
			relayKey: { ...target.teamRelayKey },
		};
	}

	async placeRelayPeer(
		rawParams: unknown,
		source: CliRecord,
	): Promise<PlaceTeamRelayPeerResult> {
		const params = this.parsePlaceRelayParams(rawParams);
		const authenticatedSource = this.resolveAuthenticatedRelaySource(source);
		const target = this.cliRegistry
			.getClisForUser(authenticatedSource.userId)
			.filter(
				(candidate) =>
					candidate !== authenticatedSource &&
					candidate.teamRelayReady &&
					candidate.teamRelayKey !== undefined &&
					candidate.backends.some(
						(backend) => backend.backendId === params.backendId,
					),
			)
			.sort((left, right) =>
				left.machineId === right.machineId
					? 0
					: left.machineId < right.machineId
						? -1
						: 1,
			)
			.find((candidate) => {
				try {
					parsePlaceTeamRelayPeerResult({
						targetMachineId: candidate.machineId,
						relayKey: candidate.teamRelayKey,
					});
					return true;
				} catch {
					return false;
				}
			});
		if (!target?.teamRelayKey) {
			this.throwRelayPeerNotFound();
		}
		return {
			targetMachineId: target.machineId,
			relayKey: { ...target.teamRelayKey },
		};
	}

	async relay(
		rawParams: unknown,
		source: CliRecord,
	): Promise<SendTeamRelayResult> {
		const params = this.parseSendRelayParams(rawParams);
		const authenticatedSource = this.resolveAuthenticatedRelaySource(source);
		const target = this.resolveRelayTarget(
			params.targetMachineId,
			authenticatedSource,
		);
		if (params.ciphertext.recipientKeyId !== target.teamRelayKey.keyId) {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Team relay recipient key mismatch",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}

		logger.info(
			{
				operationId: params.operationId,
				sourceMachineId: authenticatedSource.machineId,
				targetMachineId: target.machineId,
			},
			"team_relay_rpc_start",
		);
		const result = await this.sendRpc<
			TeamRelayExecuteRpcParams,
			TeamRelayExecuteRpcResult
		>(target.socket, "rpc:team-relay:execute", {
			operationId: params.operationId,
			sourceMachineId: authenticatedSource.machineId,
			sourceRelayKey: { ...authenticatedSource.teamRelayKey },
			ciphertext: params.ciphertext,
		});
		const parsedResult = this.parseRelayResponse(
			result,
			params.operationId,
			authenticatedSource.teamRelayKey.keyId,
		);
		logger.info(
			{
				operationId: params.operationId,
				sourceMachineId: authenticatedSource.machineId,
				targetMachineId: target.machineId,
			},
			"team_relay_rpc_complete",
		);
		return {
			operationId: parsedResult.operationId,
			targetMachineId: target.machineId,
			ciphertext: parsedResult.ciphertext,
		};
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
			pending.reject(toRpcAppError(response.error));
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

	private parseResolveRelayParams(rawParams: unknown) {
		try {
			return parseResolveTeamRelayPeerParams(rawParams);
		} catch {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid Team relay request",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
	}

	private parsePlaceRelayParams(rawParams: unknown) {
		try {
			return parsePlaceTeamRelayPeerParams(rawParams);
		} catch {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid Team relay request",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
	}

	private parseSendRelayParams(rawParams: unknown) {
		try {
			return parseSendTeamRelayParams(rawParams);
		} catch {
			throw new AppError(
				createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid Team relay request",
					retryable: false,
					scope: "request",
				}),
				400,
			);
		}
	}

	private resolveAuthenticatedRelaySource(source: CliRecord): CliRecord & {
		userId: string;
		teamRelayKey: NonNullable<CliRecord["teamRelayKey"]>;
	} {
		const registered = this.cliRegistry.getCliBySocketId(source.socket.id);
		if (
			registered !== source ||
			!registered.userId ||
			!registered.teamRelayKey ||
			!registered.teamRelayReady
		) {
			throw new AppError(
				createErrorDetail({
					code: "CAPABILITY_NOT_SUPPORTED",
					message: "Team relay unavailable",
					retryable: false,
					scope: "request",
				}),
				409,
			);
		}
		return registered as CliRecord & {
			userId: string;
			teamRelayKey: NonNullable<CliRecord["teamRelayKey"]>;
		};
	}

	private resolveRelayTarget(
		targetMachineId: string,
		source: CliRecord,
	): CliRecord & {
		userId: string;
		teamRelayKey: NonNullable<CliRecord["teamRelayKey"]>;
	} {
		const authenticatedSource = this.resolveAuthenticatedRelaySource(source);
		const target = this.cliRegistry.getCliByMachineIdForUser(
			targetMachineId,
			authenticatedSource.userId,
		);
		if (!target || target === authenticatedSource) {
			this.throwRelayPeerNotFound();
		}
		if (!target.teamRelayKey || !target.teamRelayReady) {
			throw new AppError(
				createErrorDetail({
					code: "CAPABILITY_NOT_SUPPORTED",
					message: "Team relay unavailable",
					retryable: false,
					scope: "request",
				}),
				409,
			);
		}
		return target as CliRecord & {
			userId: string;
			teamRelayKey: NonNullable<CliRecord["teamRelayKey"]>;
		};
	}

	private throwRelayPeerNotFound(): never {
		throw new AppError(
			createErrorDetail({
				code: "AUTHORIZATION_FAILED",
				message: "Team relay peer not found",
				retryable: false,
				scope: "request",
			}),
			404,
		);
	}

	private parseRelayResponse(
		rawResult: unknown,
		expectedOperationId: string,
		expectedRecipientKeyId: string,
	): TeamRelayExecuteRpcResult {
		try {
			const result = parseTeamRelayExecuteRpcResult(rawResult);
			if (
				result.operationId !== expectedOperationId ||
				result.ciphertext.recipientKeyId !== expectedRecipientKeyId
			) {
				throw new Error("Team relay response binding mismatch");
			}
			return result;
		} catch {
			throw new AppError(createInternalError("service"), 502);
		}
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
			}, TEAM_RELAY_GATEWAY_RPC_TIMEOUT_MS);
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
