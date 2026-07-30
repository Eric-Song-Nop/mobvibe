import type { AgentTeamStore } from "./agent-team-store.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	type TeamToolHandlers,
	type TeamToolName,
	type TeamToolResult,
} from "./team-tool-handlers.js";

export const TEAM_COMMAND_ENVELOPE_VERSION = 1 as const;

export type TeamCommandEnvelope = {
	version: typeof TEAM_COMMAND_ENVELOPE_VERSION;
	operationId: string;
	agentTeamId: string;
	callerMemberId: string;
	toolName: TeamToolName;
	args: unknown;
};

export type TeamCommandExecution = {
	operationId: string;
	result: TeamToolResult;
};

export type TeamCommandDispatcher = {
	dispatch(command: TeamCommandEnvelope): Promise<TeamCommandExecution>;
};

export type TeamCommandErrorCode =
	| "INVALID_ENVELOPE"
	| "UNSUPPORTED_COMMAND"
	| "CALLER_NOT_FOUND";

export class TeamCommandError extends Error {
	readonly code: TeamCommandErrorCode;

	constructor(code: TeamCommandErrorCode, message: string) {
		super(message);
		this.name = "TeamCommandError";
		this.code = code;
	}
}

export type TeamCommandBusOptions = {
	store: Pick<AgentTeamStore, "listTeamMembers">;
	handlers: Pick<TeamToolHandlers, "dispatch">;
};

const supportedCommands = new Set<string>(EXPECTED_TEAM_TOOL_NAMES);

/**
 * Executes Team commands against the leader's local runtime.
 *
 * The injected handlers must be the runtime-configured instance so mailbox
 * wake-up and ACP member spawning retain their existing behavior.
 */
export class TeamCommandBus implements TeamCommandDispatcher {
	constructor(private readonly options: TeamCommandBusOptions) {}

	async dispatch(input: TeamCommandEnvelope): Promise<TeamCommandExecution> {
		const command = parseCommandEnvelope(input);
		const member = this.options.store
			.listTeamMembers(command.agentTeamId)
			.find((candidate) => candidate.member_id === command.callerMemberId);
		if (!member) {
			throw new TeamCommandError(
				"CALLER_NOT_FOUND",
				"Team command caller not found",
			);
		}

		const result = await this.options.handlers.dispatch({
			caller: {
				agentTeamId: command.agentTeamId,
				memberId: command.callerMemberId,
				role: member.role === "leader" ? "leader" : "member",
			},
			toolName: command.toolName,
			args: command.args,
		});
		return { operationId: command.operationId, result };
	}
}

function parseCommandEnvelope(input: unknown): TeamCommandEnvelope {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new TeamCommandError(
			"INVALID_ENVELOPE",
			"Team command envelope must be an object",
		);
	}
	const record = input as Record<string, unknown>;
	if (record.version !== TEAM_COMMAND_ENVELOPE_VERSION) {
		throw new TeamCommandError(
			"INVALID_ENVELOPE",
			"Unsupported Team command envelope version",
		);
	}
	const operationId = readRequiredId(record, "operationId");
	const agentTeamId = readRequiredId(record, "agentTeamId");
	const callerMemberId = readRequiredId(record, "callerMemberId");
	const toolName = record.toolName;
	if (typeof toolName !== "string" || !supportedCommands.has(toolName)) {
		throw new TeamCommandError(
			"UNSUPPORTED_COMMAND",
			`Unsupported Team command: ${String(toolName)}`,
		);
	}
	return {
		version: TEAM_COMMAND_ENVELOPE_VERSION,
		operationId,
		agentTeamId,
		callerMemberId,
		toolName: toolName as TeamToolName,
		args: record.args,
	};
}

function readRequiredId(
	record: Record<string, unknown>,
	key: "operationId" | "agentTeamId" | "callerMemberId",
): string {
	const value = record[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new TeamCommandError(
			"INVALID_ENVELOPE",
			`Team command ${key} must be a non-empty string`,
		);
	}
	return value;
}
