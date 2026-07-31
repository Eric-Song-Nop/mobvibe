import { randomUUID } from "node:crypto";
import type { ErrorDetail } from "@mobvibe/shared";
import type { TeamToolIntent } from "./agent-team-store.js";
import type {
	TeamCommandEnvelope,
	TeamCommandExecution,
} from "./team-command-bus.js";
import type { TeamMcpBinding, TeamMcpPort } from "./team-mcp-router.js";
import type { TeamRelayStore } from "./team-relay-store.js";

export type TeamRelayCall = {
	operationId: string;
	operation: "team.command" | "member.runtime";
	targetMachineId: string;
	payload: unknown;
};

export type TeamRelayCaller = {
	call(input: TeamRelayCall): Promise<unknown>;
};

export type RemoteTeamMcpPortOptions = {
	store: Pick<TeamRelayStore, "getRemoteSessionBindingByServerId">;
	relay: TeamRelayCaller;
};

export type RemoteTeamMcpReadinessPhase =
	| "not_started"
	| "tools_waiting"
	| "tools_ready"
	| "degraded";

export type RemoteTeamMcpReadiness = {
	serverId: string;
	phase: RemoteTeamMcpReadinessPhase;
	lastError?: ErrorDetail;
};

type ReadinessWaiter = {
	resolve(readiness: RemoteTeamMcpReadiness): void;
	reject(error: Error): void;
};

/**
 * Worker-side Team MCP port.
 *
 * Team identity is read from the worker's durable remote-session binding. Team
 * facts and command effects remain authoritative on the leader machine.
 */
export class RemoteTeamMcpPort implements TeamMcpPort {
	private readonly issuedBindings = new WeakMap<
		TeamMcpBinding,
		{ leaderMachineId: string }
	>();
	private readonly readiness = new Map<string, RemoteTeamMcpReadiness>();
	private readonly readinessWaiters = new Map<string, Set<ReadinessWaiter>>();

	constructor(private readonly options: RemoteTeamMcpPortOptions) {}

	resolveBinding(
		input: Parameters<TeamMcpPort["resolveBinding"]>[0],
	): TeamMcpBinding {
		const stored = this.options.store.getRemoteSessionBindingByServerId(
			input.serverId,
		);
		if (!stored || stored.serverId !== input.serverId) {
			throw new Error("Remote Team MCP binding not found");
		}
		if (stored.lifecycle === "failed" || stored.lifecycle === "closed") {
			throw new Error("Remote Team MCP binding is not connectable");
		}

		const binding: TeamMcpBinding = {
			serverId: stored.serverId,
			transport: input.transport,
			agentTeamId: stored.agentTeamId,
			memberId: stored.memberId,
			role: "member",
			commandTarget: "leader_relay",
		};
		this.issuedBindings.set(binding, {
			leaderMachineId: stored.leaderMachineId,
		});
		return binding;
	}

	updateStatus(input: Parameters<TeamMcpPort["updateStatus"]>[0]): void {
		this.requireIssuedBinding(input.binding);
		const current = this.readiness.get(input.binding.serverId);
		if (
			input.phase === "tools_waiting" &&
			(current?.phase === "tools_ready" || current?.phase === "degraded")
		) {
			return;
		}

		const next = createReadiness({
			serverId: input.binding.serverId,
			phase: input.phase,
			lastError: input.lastError,
		});
		this.readiness.set(input.binding.serverId, next);
		if (next.phase === "tools_ready") {
			this.resolveReadinessWaiters(next);
		} else if (next.phase === "degraded") {
			this.rejectReadinessWaiters(
				next.serverId,
				new Error(next.lastError?.message ?? "Remote Team MCP is degraded"),
			);
		}
	}

	async dispatchCommand(
		input: Parameters<TeamMcpPort["dispatchCommand"]>[0],
	): Promise<TeamCommandExecution> {
		const authoritative = this.requireIssuedBinding(input.binding);
		assertCommandIdentity(input.binding, input.command);
		const result = await this.options.relay.call({
			operationId: input.command.operationId,
			operation: "team.command",
			targetMachineId: authoritative.leaderMachineId,
			payload: input.command,
		});
		return result as TeamCommandExecution;
	}

	async recordLifecycleIntent(
		input: Parameters<TeamMcpPort["recordLifecycleIntent"]>[0],
	): Promise<TeamToolIntent> {
		const authoritative = this.requireIssuedBinding(input.binding);
		const result = await this.options.relay.call({
			operationId: randomUUID(),
			operation: "member.runtime",
			targetMachineId: authoritative.leaderMachineId,
			payload: {
				agentTeamId: input.binding.agentTeamId,
				memberId: input.binding.memberId,
				kind: input.kind,
				payload: input.payload,
				sourceRefs: input.sourceRefs,
			},
		});
		return result as TeamToolIntent;
	}

	getReadiness(serverId: string): RemoteTeamMcpReadiness | undefined {
		const readiness = this.readiness.get(serverId);
		return readiness ? cloneReadiness(readiness) : undefined;
	}

	waitForReadiness(serverId: string): Promise<RemoteTeamMcpReadiness> {
		const current = this.readiness.get(serverId);
		if (current?.phase === "tools_ready") {
			return Promise.resolve(cloneReadiness(current));
		}
		if (current?.phase === "degraded") {
			return Promise.reject(
				new Error(current.lastError?.message ?? "Remote Team MCP is degraded"),
			);
		}

		return new Promise((resolve, reject) => {
			const waiters =
				this.readinessWaiters.get(serverId) ?? new Set<ReadinessWaiter>();
			waiters.add({ resolve, reject });
			this.readinessWaiters.set(serverId, waiters);
		});
	}

	forgetReadiness(serverId: string): void {
		this.readiness.delete(serverId);
		this.rejectReadinessWaiters(
			serverId,
			new Error("Remote Team MCP readiness forgotten"),
		);
	}

	private requireIssuedBinding(binding: TeamMcpBinding): {
		leaderMachineId: string;
	} {
		const authoritative = this.issuedBindings.get(binding);
		if (!authoritative) {
			throw new Error("Remote Team MCP binding was not issued by this port");
		}
		return authoritative;
	}

	private resolveReadinessWaiters(readiness: RemoteTeamMcpReadiness): void {
		const waiters = this.readinessWaiters.get(readiness.serverId);
		if (!waiters) return;
		this.readinessWaiters.delete(readiness.serverId);
		for (const waiter of waiters) {
			waiter.resolve(cloneReadiness(readiness));
		}
	}

	private rejectReadinessWaiters(serverId: string, error: Error): void {
		const waiters = this.readinessWaiters.get(serverId);
		if (!waiters) return;
		this.readinessWaiters.delete(serverId);
		for (const waiter of waiters) {
			waiter.reject(error);
		}
	}
}

export function createRemoteTeamMcpPort(
	options: RemoteTeamMcpPortOptions,
): RemoteTeamMcpPort {
	return new RemoteTeamMcpPort(options);
}

function assertCommandIdentity(
	binding: TeamMcpBinding,
	command: TeamCommandEnvelope,
): void {
	if (
		command.agentTeamId !== binding.agentTeamId ||
		command.callerMemberId !== binding.memberId
	) {
		throw new Error("Team command identity does not match remote binding");
	}
}

function createReadiness(input: {
	serverId: string;
	phase: RemoteTeamMcpReadinessPhase;
	lastError?: ErrorDetail;
}): RemoteTeamMcpReadiness {
	return input.lastError
		? {
				serverId: input.serverId,
				phase: input.phase,
				lastError: { ...input.lastError },
			}
		: {
				serverId: input.serverId,
				phase: input.phase,
			};
}

function cloneReadiness(
	readiness: RemoteTeamMcpReadiness,
): RemoteTeamMcpReadiness {
	return createReadiness(readiness);
}
