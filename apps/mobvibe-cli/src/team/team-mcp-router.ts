import { createErrorDetail, type TeamSourceRef } from "@mobvibe/shared";
import type { AgentTeamStore, TeamToolIntent, TeamToolIntentKind } from "./agent-team-store.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	type TeamToolCaller,
	TeamToolHandlers,
	type TeamToolName,
	type TeamToolResult,
} from "./team-tool-handlers.js";

export type TeamMcpRouterOptions = {
	store: AgentTeamStore;
	handlers: TeamToolHandlers;
};

type ServerBinding = TeamToolCaller & {
	serverId: string;
};

export class TeamMcpRouter {
	private readonly bindings = new Map<string, ServerBinding>();

	constructor(private readonly options: TeamMcpRouterOptions) {}

	handleConnect(input: { serverId: string }): TeamToolCaller {
		const binding = this.bindServer(input.serverId);
		this.options.store.updateMcpStatus({
			agentTeamId: binding.agentTeamId,
			memberId: binding.memberId,
			transport: "acp",
			serverId: input.serverId,
			phase: "tools_waiting",
		});
		return binding;
	}

	handleDisconnect(input: { serverId: string }): void {
		this.bindings.delete(input.serverId);
	}

	handleListTools(input: { serverId: string; toolNames: string[] }): void {
		const binding = this.requireBinding(input.serverId);
		const missing = EXPECTED_TEAM_TOOL_NAMES.filter(
			(name) => !input.toolNames.includes(name),
		);
		this.options.store.updateMcpStatus({
			agentTeamId: binding.agentTeamId,
			memberId: binding.memberId,
			transport: "acp",
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
		return this.options.handlers.dispatch({
			caller: binding,
			toolName: input.toolName,
			args: input.args,
		});
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

	private bindServer(serverId: string): ServerBinding {
		const parsed = parseServerId(serverId);
		const member = this.options.store
			.listTeamMembers(parsed.agentTeamId)
			.find((row) => row.member_id === parsed.memberId);
		if (!member) {
			throw new Error("Team MCP member binding not found");
		}
		const binding: ServerBinding = {
			serverId,
			agentTeamId: parsed.agentTeamId,
			memberId: parsed.memberId,
			role: member.role === "leader" ? "leader" : "member",
		};
		this.bindings.set(serverId, binding);
		return binding;
	}

	private requireBinding(serverId: string): ServerBinding {
		const binding = this.bindings.get(serverId);
		if (!binding) {
			throw new Error("Team MCP caller is not bound");
		}
		return binding;
	}
}

function parseServerId(serverId: string): { agentTeamId: string; memberId: string } {
	const parts = serverId.split(":");
	if (parts.length !== 3 || parts[0] !== "mobvibe-team") {
		throw new Error("Invalid Team MCP server id");
	}
	return { agentTeamId: parts[1], memberId: parts[2] };
}
