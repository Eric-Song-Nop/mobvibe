import { createHash } from "node:crypto";
import {
	AppError,
	createErrorDetail,
	TEAM_RELAY_OPERATION_ID_MAX_BYTES,
} from "@mobvibe/shared";
import type { AgentTeamStore } from "./agent-team-store.js";
import type { TeamRelayOperationHandler } from "./team-relay-endpoint.js";
import type { VerifiedTeamRelayRequest } from "./team-relay-protocol.js";
import type { TeamRuntime } from "./team-runtime.js";

export const TEAM_RUNTIME_RELAY_VERSION = 1 as const;

const TEAM_RUNTIME_IDENTIFIER_MAX_BYTES = 256;
const TEAM_RUNTIME_SESSION_ID_MAX_BYTES = 1024;
const TEAM_RUNTIME_OPERATION_PREFIX = "team-runtime:v1:";
const TEAM_RUNTIME_TURN_ID_PATTERN = /^[0-9a-f]{64}$/;
const TEAM_RUNTIME_PAYLOAD_KEYS = [
	"version",
	"type",
	"operationId",
	"agentTeamId",
	"memberId",
	"turnId",
] as const;
const TEAM_RUNTIME_ACK_KEYS = ["operationId", "accepted"] as const;
const INVALID_IDENTIFIER_PATTERN = /[\p{Cc}\p{Cs}]/u;
const UTF8_ENCODER = new TextEncoder();

export type TeamRuntimeRelayPayload = {
	version: typeof TEAM_RUNTIME_RELAY_VERSION;
	type: "turn_completed";
	operationId: string;
	agentTeamId: string;
	memberId: string;
	turnId: string;
};

export type TeamRuntimeRelayAck = {
	operationId: string;
	accepted: true;
};

export type TeamTurnCompletedRelayInput = {
	agentTeamId: string;
	memberId: string;
	sessionId: string;
	revision: number;
	seq: number;
};

export type LeaderTeamRuntimeRelayStore = Pick<
	AgentTeamStore,
	"getTeamMemberExecution" | "listTeamMembers"
>;

export type LeaderTeamRuntimeRelayOptions = {
	store: LeaderTeamRuntimeRelayStore;
	runtime: Pick<TeamRuntime, "onMemberTurnCompleted">;
};

export const createTeamTurnCompletedRelayPayload = (
	input: TeamTurnCompletedRelayInput,
): TeamRuntimeRelayPayload => {
	const agentTeamId = parseIdentifier(
		input.agentTeamId,
		TEAM_RUNTIME_IDENTIFIER_MAX_BYTES,
	);
	const memberId = parseIdentifier(
		input.memberId,
		TEAM_RUNTIME_IDENTIFIER_MAX_BYTES,
	);
	const sessionId = parseIdentifier(
		input.sessionId,
		TEAM_RUNTIME_SESSION_ID_MAX_BYTES,
	);
	const revision = parsePositiveSafeInteger(input.revision);
	const seq = parsePositiveSafeInteger(input.seq);
	const turnId = createHash("sha256")
		.update(
			JSON.stringify([
				"member.runtime",
				"turn_completed",
				agentTeamId,
				memberId,
				sessionId,
				revision,
				seq,
			]),
		)
		.digest("hex");

	return {
		version: TEAM_RUNTIME_RELAY_VERSION,
		type: "turn_completed",
		operationId: `${TEAM_RUNTIME_OPERATION_PREFIX}${turnId}`,
		agentTeamId,
		memberId,
		turnId,
	};
};

export const parseTeamRuntimeRelayPayload = (
	request: VerifiedTeamRelayRequest,
): TeamRuntimeRelayPayload => {
	if (request.operation !== "member.runtime") {
		throw invalidRuntimeRelayError();
	}
	const payload = request.payload;
	if (
		!isPlainRecord(payload) ||
		!hasExactKeys(payload, TEAM_RUNTIME_PAYLOAD_KEYS)
	) {
		throw invalidRuntimeRelayError();
	}
	if (
		payload.version !== TEAM_RUNTIME_RELAY_VERSION ||
		payload.type !== "turn_completed"
	) {
		throw invalidRuntimeRelayError();
	}

	const operationId = parseIdentifier(
		payload.operationId,
		TEAM_RELAY_OPERATION_ID_MAX_BYTES,
	);
	if (operationId !== request.operationId) {
		throw invalidRuntimeRelayError();
	}
	const turnId = parseIdentifier(
		payload.turnId,
		TEAM_RUNTIME_IDENTIFIER_MAX_BYTES,
	);
	if (
		!TEAM_RUNTIME_TURN_ID_PATTERN.test(turnId) ||
		operationId !== `${TEAM_RUNTIME_OPERATION_PREFIX}${turnId}`
	) {
		throw invalidRuntimeRelayError();
	}

	return {
		version: TEAM_RUNTIME_RELAY_VERSION,
		type: "turn_completed",
		operationId,
		agentTeamId: parseIdentifier(
			payload.agentTeamId,
			TEAM_RUNTIME_IDENTIFIER_MAX_BYTES,
		),
		memberId: parseIdentifier(
			payload.memberId,
			TEAM_RUNTIME_IDENTIFIER_MAX_BYTES,
		),
		turnId,
	};
};

export const parseTeamRuntimeRelayAck = (
	value: unknown,
	expectedOperationId: string,
): TeamRuntimeRelayAck => {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, TEAM_RUNTIME_ACK_KEYS) ||
		value.accepted !== true
	) {
		throw invalidRuntimeRelayError();
	}
	const operationId = parseIdentifier(
		value.operationId,
		TEAM_RELAY_OPERATION_ID_MAX_BYTES,
	);
	if (operationId !== expectedOperationId) {
		throw invalidRuntimeRelayError();
	}
	return { operationId, accepted: true };
};

export const createLeaderTeamRuntimeRelayHandler = (
	options: LeaderTeamRuntimeRelayOptions,
): TeamRelayOperationHandler => {
	return async (request): Promise<TeamRuntimeRelayAck> => {
		const event = parseTeamRuntimeRelayPayload(request);

		let route: ReturnType<
			LeaderTeamRuntimeRelayStore["getTeamMemberExecution"]
		>;
		try {
			route = options.store.getTeamMemberExecution(
				event.agentTeamId,
				event.memberId,
			);
		} catch {
			throw internalRuntimeRelayError();
		}
		if (
			!route ||
			route.agentTeamId !== event.agentTeamId ||
			route.memberId !== event.memberId ||
			route.executionMachineId !== request.sourceMachineId ||
			route.workerRelayKeyId !== request.sourceRelayKey.keyId
		) {
			throw unauthorizedRuntimeRelayError();
		}

		let memberRole: string | undefined;
		try {
			memberRole = options.store
				.listTeamMembers(event.agentTeamId)
				.find(
					(member) =>
						member.agent_team_id === event.agentTeamId &&
						member.member_id === event.memberId,
				)?.role;
		} catch {
			throw internalRuntimeRelayError();
		}
		if (memberRole !== "member") {
			throw unauthorizedRuntimeRelayError();
		}

		try {
			await options.runtime.onMemberTurnCompleted(
				event.agentTeamId,
				event.memberId,
			);
		} catch {
			throw internalRuntimeRelayError();
		}
		return {
			operationId: event.operationId,
			accepted: true,
		};
	};
};

const parseIdentifier = (value: unknown, maxBytes: number): string => {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		INVALID_IDENTIFIER_PATTERN.test(value) ||
		UTF8_ENCODER.encode(value).byteLength > maxBytes
	) {
		throw invalidRuntimeRelayError();
	}
	return value;
};

const parsePositiveSafeInteger = (value: unknown): number => {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw invalidRuntimeRelayError();
	}
	return value as number;
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

const invalidRuntimeRelayError = (): AppError =>
	new AppError(
		createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message: "Invalid Team runtime relay request",
			retryable: false,
			scope: "request",
		}),
		400,
	);

const unauthorizedRuntimeRelayError = (): AppError =>
	new AppError(
		createErrorDetail({
			code: "AUTHORIZATION_FAILED",
			message: "Team runtime relay caller is not authorized",
			retryable: false,
			scope: "request",
		}),
		403,
	);

const internalRuntimeRelayError = (): AppError =>
	new AppError(
		createErrorDetail({
			code: "INTERNAL_ERROR",
			message: "Internal server error",
			retryable: true,
			scope: "request",
		}),
		500,
	);
