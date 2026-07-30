import { randomUUID } from "node:crypto";
import {
	createErrorDetail,
	type TeamMcpTransport,
	type TeamSourceRef,
} from "@mobvibe/shared";
import type {
	AgentTeamStore,
	TeamToolIntent,
	TeamToolIntentKind,
} from "./agent-team-store.js";
import {
	TEAM_COMMAND_ENVELOPE_VERSION,
	type TeamCommandDispatcher,
} from "./team-command-bus.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	type TeamToolCaller,
	type TeamToolHandlers,
	type TeamToolName,
	type TeamToolResult,
} from "./team-tool-handlers.js";

export type TeamMcpRouterOptions = {
	store: AgentTeamStore;
	handlers: Pick<TeamToolHandlers, "recordLifecycleIntent">;
	dispatcher: TeamCommandDispatcher;
};

type ServerBinding = TeamToolCaller & {
	serverId: string;
	transport: TeamMcpTransport;
};

type ServerBindingState = {
	binding: ServerBinding;
	connectionCount: number;
};

export class TeamMcpRouter {
	private readonly bindings = new Map<string, ServerBindingState>();

	constructor(private readonly options: TeamMcpRouterOptions) {}

	handleConnect(input: {
		serverId: string;
		transport?: TeamMcpTransport;
	}): TeamToolCaller {
		const existing = this.bindings.get(input.serverId);
		const binding =
			existing?.binding ??
			this.createBinding(input.serverId, input.transport ?? "acp");
		if (existing) {
			existing.connectionCount += 1;
		} else {
			this.bindings.set(input.serverId, {
				binding,
				connectionCount: 1,
			});
		}
		this.options.store.updateMcpStatus({
			agentTeamId: binding.agentTeamId,
			memberId: binding.memberId,
			transport: binding.transport,
			serverId: input.serverId,
			phase: "tools_waiting",
		});
		return binding;
	}

	handleDisconnect(input: { serverId: string }): void {
		const state = this.bindings.get(input.serverId);
		if (!state) return;
		if (state.connectionCount > 1) {
			state.connectionCount -= 1;
			return;
		}
		this.bindings.delete(input.serverId);
		this.options.store.updateMcpStatus({
			agentTeamId: state.binding.agentTeamId,
			memberId: state.binding.memberId,
			transport: state.binding.transport,
			serverId: input.serverId,
			phase: "not_started",
		});
	}

	handleListTools(input: { serverId: string; toolNames: string[] }): void {
		const binding = this.requireBinding(input.serverId);
		const missing = EXPECTED_TEAM_TOOL_NAMES.filter(
			(name) => !input.toolNames.includes(name),
		);
		this.options.store.updateMcpStatus({
			agentTeamId: binding.agentTeamId,
			memberId: binding.memberId,
			transport: binding.transport,
			serverId: input.serverId,
			phase: missing.length === 0 ? "tools_ready" : "degraded",
			lastError:
				missing.length === 0
					? undefined
					: createErrorDetail({
							code: "CAPABILITY_NOT_SUPPORTED",
							message: `Missing team MCP tools: ${missing.join(", ")}`,
							retryable: true,
							scope: "session",
						}),
		});
	}

	async handleToolCall(input: {
		serverId: string;
		toolName: TeamToolName;
		args: unknown;
	}): Promise<TeamToolResult> {
		const binding = this.requireBinding(input.serverId);
		const execution = await this.options.dispatcher.dispatch({
			version: TEAM_COMMAND_ENVELOPE_VERSION,
			operationId: randomUUID(),
			agentTeamId: binding.agentTeamId,
			callerMemberId: binding.memberId,
			toolName: input.toolName,
			args: input.args,
		});
		return execution.result;
	}

	async recordLifecycleIntent(input: {
		serverId: string;
		kind: TeamToolIntentKind;
		payload: Record<string, unknown>;
		sourceRefs: TeamSourceRef[];
	}): Promise<TeamToolIntent> {
		const binding = this.requireBinding(input.serverId);
		return this.options.handlers.recordLifecycleIntent({
			caller: binding,
			kind: input.kind,
			payload: input.payload,
			sourceRefs: input.sourceRefs,
		});
	}

	private createBinding(
		serverId: string,
		transport: TeamMcpTransport,
	): ServerBinding {
		const parsed = parseServerId(serverId);
		const member = this.options.store
			.listTeamMembers(parsed.agentTeamId)
			.find((row) => row.member_id === parsed.memberId);
		if (!member) {
			throw new Error("Team MCP member binding not found");
		}
		const binding: ServerBinding = {
			serverId,
			transport,
			agentTeamId: parsed.agentTeamId,
			memberId: parsed.memberId,
			role: member.role === "leader" ? "leader" : "member",
		};
		return binding;
	}

	private requireBinding(serverId: string): ServerBinding {
		const state = this.bindings.get(serverId);
		if (!state) {
			throw new Error("Team MCP caller is not bound");
		}
		return state.binding;
	}
}

function parseServerId(serverId: string): {
	agentTeamId: string;
	memberId: string;
} {
	const parts = serverId.split(":");
	if (parts.length !== 3 || parts[0] !== "mobvibe-team") {
		throw new Error("Invalid Team MCP server id");
	}
	return { agentTeamId: parts[1], memberId: parts[2] };
}
