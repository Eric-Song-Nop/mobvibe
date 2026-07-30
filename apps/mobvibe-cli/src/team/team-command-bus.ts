import { createHash } from "node:crypto";
import type {
	AgentTeamStore,
	TeamCommandJournalError,
} from "./agent-team-store.js";
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
	| "CALLER_NOT_FOUND"
	| "OPERATION_CONFLICT"
	| "OUTCOME_UNKNOWN"
	| "EXECUTION_FAILED"
	| "JOURNAL_CORRUPTED";

export class TeamCommandError extends Error {
	readonly code: TeamCommandErrorCode;

	constructor(code: TeamCommandErrorCode, message: string) {
		super(message);
		this.name = "TeamCommandError";
		this.code = code;
	}
}

export type TeamCommandBusOptions = {
	store: Pick<
		AgentTeamStore,
		| "listTeamMembers"
		| "claimTeamCommand"
		| "completeTeamCommand"
		| "failTeamCommand"
	>;
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

		const sourceScope = canonicalJson({
			agentTeamId: command.agentTeamId,
			callerMemberId: command.callerMemberId,
		});
		const payloadDigest = createPayloadDigest(command);
		const claim = this.options.store.claimTeamCommand({
			sourceScope,
			operationId: command.operationId,
			agentTeamId: command.agentTeamId,
			callerMemberId: command.callerMemberId,
			payloadDigest,
		});
		switch (claim.status) {
			case "completed":
				return {
					operationId: command.operationId,
					result: parseStoredResult(claim.result, command),
				};
			case "failed":
				throw executionFailure(claim.error);
			case "in_progress":
				throw outcomeUnknown();
			case "conflict":
				throw new TeamCommandError(
					"OPERATION_CONFLICT",
					"Team command operationId conflicts with its original payload",
				);
			case "claimed":
				return this.executeClaimedCommand({
					command,
					sourceScope,
					payloadDigest,
					claimId: claim.claimId,
					role: member.role === "leader" ? "leader" : "member",
				});
		}
	}

	private async executeClaimedCommand(params: {
		command: TeamCommandEnvelope;
		sourceScope: string;
		payloadDigest: string;
		claimId: string;
		role: "leader" | "member";
	}): Promise<TeamCommandExecution> {
		let result: TeamToolResult;
		try {
			result = await this.options.handlers.dispatch({
				caller: {
					agentTeamId: params.command.agentTeamId,
					memberId: params.command.callerMemberId,
					role: params.role,
				},
				toolName: params.command.toolName,
				args: params.command.args,
			});
		} catch (error) {
			this.failClaim(params, error);
		}

		let persisted: unknown;
		try {
			persisted = this.options.store.completeTeamCommand({
				sourceScope: params.sourceScope,
				operationId: params.command.operationId,
				payloadDigest: params.payloadDigest,
				claimId: params.claimId,
				result,
			});
		} catch {
			// The handler has already returned, so its side effects may have
			// committed. Keep the durable claim unresolved and never retry it.
			throw outcomeUnknown();
		}
		return {
			operationId: params.command.operationId,
			result: parseStoredResult(persisted, params.command),
		};
	}

	private failClaim(
		params: {
			command: TeamCommandEnvelope;
			sourceScope: string;
			payloadDigest: string;
			claimId: string;
		},
		error: unknown,
	): never {
		const storedError = toJournalError(error);
		try {
			this.options.store.failTeamCommand({
				sourceScope: params.sourceScope,
				operationId: params.command.operationId,
				payloadDigest: params.payloadDigest,
				claimId: params.claimId,
				error: storedError,
			});
		} catch {
			throw outcomeUnknown();
		}
		throw executionFailure(storedError);
	}
}

function parseStoredResult(
	value: unknown,
	command: TeamCommandEnvelope,
): TeamToolResult {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw corruptedJournal();
	}
	const record = value as Record<string, unknown>;
	const caller = record.caller;
	if (!caller || typeof caller !== "object" || Array.isArray(caller)) {
		throw corruptedJournal();
	}
	const callerRecord = caller as Record<string, unknown>;
	if (
		callerRecord.agentTeamId !== command.agentTeamId ||
		callerRecord.memberId !== command.callerMemberId ||
		(callerRecord.role !== "leader" && callerRecord.role !== "member") ||
		record.toolName !== command.toolName
	) {
		throw corruptedJournal();
	}
	return {
		caller: {
			agentTeamId: callerRecord.agentTeamId,
			memberId: callerRecord.memberId,
			role: callerRecord.role,
		},
		toolName: command.toolName,
		data: record.data,
	};
}

function createPayloadDigest(command: TeamCommandEnvelope): string {
	const payload = canonicalJson({
		version: command.version,
		toolName: command.toolName,
		args: command.args,
	});
	return createHash("sha256").update(payload).digest("hex");
}

function outcomeUnknown(): TeamCommandError {
	return new TeamCommandError(
		"OUTCOME_UNKNOWN",
		"Team command outcome is unknown; do not retry with the same operationId",
	);
}

function executionFailure(error: TeamCommandJournalError): TeamCommandError {
	return new TeamCommandError("EXECUTION_FAILED", error.message);
}

function corruptedJournal(): TeamCommandError {
	return new TeamCommandError(
		"JOURNAL_CORRUPTED",
		"Invalid completed Team command journal result",
	);
}

function toJournalError(error: unknown): TeamCommandJournalError {
	return {
		name: error instanceof Error ? error.name : "Error",
		message:
			error instanceof Error
				? error.message.slice(0, 1_000)
				: "Team command execution failed",
	};
}

type CanonicalJsonValue =
	| null
	| boolean
	| number
	| string
	| CanonicalJsonValue[]
	| { [key: string]: CanonicalJsonValue };

function canonicalJson(value: unknown): string {
	const normalized = toCanonicalJsonValue(value, new Set());
	if (normalized === undefined) {
		throw new TeamCommandError(
			"INVALID_ENVELOPE",
			"Team command payload must be JSON-serializable",
		);
	}
	return JSON.stringify(normalized);
}

function toCanonicalJsonValue(
	value: unknown,
	seen: Set<object>,
): CanonicalJsonValue | undefined {
	if (value === undefined) return undefined;
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TeamCommandError(
				"INVALID_ENVELOPE",
				"Team command payload contains a non-finite number",
			);
		}
		return value;
	}
	if (typeof value !== "object") {
		throw new TeamCommandError(
			"INVALID_ENVELOPE",
			"Team command payload must be JSON-serializable",
		);
	}
	if (seen.has(value)) {
		throw new TeamCommandError(
			"INVALID_ENVELOPE",
			"Team command payload must not contain cycles",
		);
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((child) => toCanonicalJsonValue(child, seen) ?? null);
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TeamCommandError(
				"INVALID_ENVELOPE",
				"Team command payload must contain plain JSON objects",
			);
		}
		const canonical: { [key: string]: CanonicalJsonValue } = {};
		for (const key of Object.keys(value).sort()) {
			const child = toCanonicalJsonValue(
				(value as Record<string, unknown>)[key],
				seen,
			);
			if (child !== undefined) canonical[key] = child;
		}
		return canonical;
	} finally {
		seen.delete(value);
	}
}

function normalizeCommandArgs(value: unknown): unknown {
	if (value === undefined) return undefined;
	return JSON.parse(canonicalJson(value)) as unknown;
}

/*
 * Keep the envelope parser at the transport boundary so local and future
 * relayed commands share the same validation and canonical JSON semantics.
 */
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
		args: normalizeCommandArgs(record.args),
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
