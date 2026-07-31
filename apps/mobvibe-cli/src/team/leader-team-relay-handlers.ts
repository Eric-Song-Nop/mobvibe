import {
	AppError,
	createErrorDetail,
	TEAM_RELAY_OPERATION_ID_MAX_BYTES,
} from "@mobvibe/shared";
import type { AgentTeamStore } from "./agent-team-store.js";
import {
	TEAM_COMMAND_ENVELOPE_VERSION,
	type TeamCommandDispatcher,
	type TeamCommandEnvelope,
	type TeamCommandExecution,
} from "./team-command-bus.js";
import type {
	TeamRelayOperationHandler,
	TeamRelayOperationHandlers,
} from "./team-relay-endpoint.js";
import type { VerifiedTeamRelayRequest } from "./team-relay-protocol.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	type TeamToolName,
} from "./team-tool-handlers.js";

const TEAM_COMMAND_ID_MAX_BYTES = 256;
const UTF8_ENCODER = new TextEncoder();
const INVALID_IDENTIFIER_PATTERN = /[\p{Cc}\p{Cs}]/u;
const COMMAND_KEYS = [
	"version",
	"operationId",
	"agentTeamId",
	"callerMemberId",
	"toolName",
	"args",
] as const;
const SUPPORTED_TOOL_NAMES = new Set<string>(EXPECTED_TEAM_TOOL_NAMES);

export type LeaderTeamRelayHandlerStore = Pick<
	AgentTeamStore,
	"getTeamMemberExecution" | "listTeamMembers"
>;

export type LeaderTeamRelayHandlerOptions = {
	store: LeaderTeamRelayHandlerStore;
	dispatcher: TeamCommandDispatcher;
};

type LeaderTeamRelayOperationHandlers = Pick<
	TeamRelayOperationHandlers,
	"team.command"
> & {
	"team.command": TeamRelayOperationHandler;
};

/**
 * Builds leader-side relay handlers. Team state is resolved exclusively from
 * the leader's local store; the Gateway-supplied machine identity alone never
 * grants a worker access to a member identity.
 */
export const createLeaderTeamRelayHandlers = (
	options: LeaderTeamRelayHandlerOptions,
): LeaderTeamRelayOperationHandlers => ({
	"team.command": async (
		request: VerifiedTeamRelayRequest,
	): Promise<TeamCommandExecution> => {
		const command = parseRelayCommand(request);

		let route: ReturnType<
			LeaderTeamRelayHandlerStore["getTeamMemberExecution"]
		>;
		try {
			route = options.store.getTeamMemberExecution(
				command.agentTeamId,
				command.callerMemberId,
			);
		} catch {
			throw internalRelayError();
		}
		if (
			!route ||
			route.agentTeamId !== command.agentTeamId ||
			route.memberId !== command.callerMemberId ||
			route.executionMachineId !== request.sourceMachineId ||
			route.workerRelayKeyId !== request.sourceRelayKey.keyId
		) {
			throw unauthorizedRelayError();
		}

		let callerRole: string | undefined;
		try {
			callerRole = options.store
				.listTeamMembers(command.agentTeamId)
				.find(
					(member) =>
						member.agent_team_id === command.agentTeamId &&
						member.member_id === command.callerMemberId,
				)?.role;
		} catch {
			throw internalRelayError();
		}
		if (callerRole !== "member") {
			throw unauthorizedRelayError();
		}

		let execution: TeamCommandExecution;
		try {
			execution = await options.dispatcher.dispatch(command);
		} catch {
			throw internalRelayError();
		}
		if (execution.operationId !== command.operationId) {
			throw internalRelayError();
		}
		return execution;
	},
});

const parseRelayCommand = (
	request: VerifiedTeamRelayRequest,
): TeamCommandEnvelope => {
	if (request.operation !== "team.command") {
		throw invalidRelayRequestError();
	}

	const payload = request.payload;
	if (!isPlainRecord(payload) || !hasExactKeys(payload, COMMAND_KEYS)) {
		throw invalidRelayRequestError();
	}
	if (payload.version !== TEAM_COMMAND_ENVELOPE_VERSION) {
		throw invalidRelayRequestError();
	}

	const operationId = parseIdentifier(
		payload.operationId,
		TEAM_RELAY_OPERATION_ID_MAX_BYTES,
	);
	const agentTeamId = parseIdentifier(
		payload.agentTeamId,
		TEAM_COMMAND_ID_MAX_BYTES,
	);
	const callerMemberId = parseIdentifier(
		payload.callerMemberId,
		TEAM_COMMAND_ID_MAX_BYTES,
	);
	if (operationId !== request.operationId) {
		throw invalidRelayRequestError();
	}
	if (
		typeof payload.toolName !== "string" ||
		!SUPPORTED_TOOL_NAMES.has(payload.toolName)
	) {
		throw invalidRelayRequestError();
	}

	return {
		version: TEAM_COMMAND_ENVELOPE_VERSION,
		operationId,
		agentTeamId,
		callerMemberId,
		toolName: payload.toolName as TeamToolName,
		args: normalizeJsonValue(payload.args, new Set()),
	};
};

const parseIdentifier = (value: unknown, maxBytes: number): string => {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		INVALID_IDENTIFIER_PATTERN.test(value) ||
		UTF8_ENCODER.encode(value).byteLength > maxBytes
	) {
		throw invalidRelayRequestError();
	}
	return value;
};

const normalizeJsonValue = (
	value: unknown,
	ancestors: Set<object>,
): unknown => {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw invalidRelayRequestError();
		return value;
	}
	if (typeof value !== "object" || value === null || ancestors.has(value)) {
		throw invalidRelayRequestError();
	}

	const prototype = Object.getPrototypeOf(value);
	if (
		!Array.isArray(value) &&
		prototype !== Object.prototype &&
		prototype !== null
	) {
		throw invalidRelayRequestError();
	}

	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((child) => normalizeJsonValue(child, ancestors));
		}
		const normalized: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			const child = (value as Record<string, unknown>)[key];
			if (child === undefined) throw invalidRelayRequestError();
			normalized[key] = normalizeJsonValue(child, ancestors);
		}
		return normalized;
	} finally {
		ancestors.delete(value);
	}
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const hasExactKeys = (
	value: Record<string, unknown>,
	expectedKeys: readonly string[],
): boolean => {
	const actualKeys = Reflect.ownKeys(value);
	return (
		actualKeys.length === expectedKeys.length &&
		expectedKeys.every((key) => Object.hasOwn(value, key))
	);
};

const invalidRelayRequestError = (): AppError =>
	new AppError(
		createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message: "Invalid Team command relay request",
			retryable: false,
			scope: "request",
		}),
		400,
	);

const unauthorizedRelayError = (): AppError =>
	new AppError(
		createErrorDetail({
			code: "AUTHORIZATION_FAILED",
			message: "Team command relay caller is not authorized",
			retryable: false,
			scope: "request",
		}),
		403,
	);

const internalRelayError = (): AppError =>
	new AppError(
		createErrorDetail({
			code: "INTERNAL_ERROR",
			message: "Internal server error",
			retryable: true,
			scope: "request",
		}),
		500,
	);
