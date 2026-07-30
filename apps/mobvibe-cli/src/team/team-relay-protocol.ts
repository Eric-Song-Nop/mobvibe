import type {
	ErrorDetail,
	SendTeamRelayParams,
	TeamRelayCiphertext,
	TeamRelayExecuteRpcParams,
	TeamRelayExecuteRpcResult,
	TeamRelayPublicKey,
} from "@mobvibe/shared";
import {
	AppError,
	isTeamRelayPublicKey,
	parseTeamRelayExecuteRpcParams,
	TEAM_RELAY_ENVELOPE_VERSION,
	TEAM_RELAY_MACHINE_ID_MAX_BYTES,
	TEAM_RELAY_OPERATION_ID_MAX_BYTES,
} from "@mobvibe/shared";
import type { CliCryptoService } from "../e2ee/crypto-service.js";

export const TEAM_RELAY_OPERATIONS = [
	"member.bootstrap",
	"member.inspect",
	"member.close",
	"team.command",
	"member.runtime",
	"member.mailbox",
] as const;

export type TeamRelayOperation = (typeof TEAM_RELAY_OPERATIONS)[number];

export type TeamRelaySafeErrorDetail = Omit<ErrorDetail, "detail">;

export type VerifiedTeamRelayRequest = {
	operationId: string;
	operation: TeamRelayOperation;
	sourceMachineId: string;
	sourceRelayKey: TeamRelayPublicKey;
	targetMachineId: string;
	payload: unknown;
};

type TeamRelayRequestEnvelope = {
	version: typeof TEAM_RELAY_ENVELOPE_VERSION;
	operationId: string;
	operation: TeamRelayOperation;
	sourceMachineId: string;
	sourceRelayKeyId: string;
	targetMachineId: string;
	targetRelayKeyId: string;
	payload: unknown;
};

type TeamRelayResponseOutcome =
	| { ok: true; value: unknown }
	| { ok: false; error: TeamRelaySafeErrorDetail };

type TeamRelayResponseEnvelope = Omit<TeamRelayRequestEnvelope, "payload"> & {
	outcome: TeamRelayResponseOutcome;
};

type TeamRelayProtocolOptions = {
	machineId: string;
	cryptoService: CliCryptoService;
};

type SealTeamRelayRequestInput = {
	operationId: string;
	operation: TeamRelayOperation;
	targetMachineId: string;
	targetRelayKey: TeamRelayPublicKey;
	payload: unknown;
};

type OpenTeamRelayResponseInput = {
	operationId: string;
	operation: TeamRelayOperation;
	targetMachineId: string;
	targetRelayKey: TeamRelayPublicKey;
	ciphertext: TeamRelayCiphertext;
};

const ERROR_CODES = new Set<ErrorDetail["code"]>([
	"ACP_CONNECT_FAILED",
	"ACP_PROCESS_EXITED",
	"ACP_CONNECTION_CLOSED",
	"ACP_PROTOCOL_MISMATCH",
	"AGENT_AUTHENTICATION_REQUIRED",
	"AGENT_AUTHENTICATION_FAILED",
	"SESSION_NOT_FOUND",
	"SESSION_NOT_READY",
	"SESSION_BUSY",
	"CAPABILITY_NOT_SUPPORTED",
	"REQUEST_VALIDATION_FAILED",
	"MESSAGE_OUTCOME_UNKNOWN",
	"INSTANCE_AFFINITY_CHANGED",
	"AUTHORIZATION_FAILED",
	"STREAM_DISCONNECTED",
	"GIT_WORKTREE_FAILED",
	"INTERNAL_ERROR",
]);
const ERROR_SCOPES = new Set<ErrorDetail["scope"]>([
	"service",
	"session",
	"stream",
	"request",
]);
const OPERATION_SET = new Set<string>(TEAM_RELAY_OPERATIONS);
const TEAM_RELAY_KEY_ID_MAX_BYTES = 256;
const TEAM_RELAY_ERROR_MESSAGE_MAX_BYTES = 2048;

export class TeamRelayRemoteError extends Error {
	readonly detail: TeamRelaySafeErrorDetail;

	constructor(detail: TeamRelaySafeErrorDetail) {
		super(detail.message);
		this.name = "TeamRelayRemoteError";
		this.detail = detail;
	}
}

export class TeamRelayProtocol {
	readonly machineId: string;
	readonly cryptoService: CliCryptoService;
	private readonly verifiedRequests = new WeakSet<object>();

	constructor(options: TeamRelayProtocolOptions) {
		if (
			!isBoundedIdentifier(options.machineId, TEAM_RELAY_MACHINE_ID_MAX_BYTES)
		) {
			throw new Error("Invalid local Team relay machine identity");
		}
		this.machineId = options.machineId;
		this.cryptoService = options.cryptoService;
	}

	get relayKey(): TeamRelayPublicKey {
		return this.cryptoService.getTeamRelayPublicKey();
	}

	sealRequest(input: SealTeamRelayRequestInput): SendTeamRelayParams {
		if (!isTeamRelayPublicKey(input.targetRelayKey)) {
			throw new Error("Invalid Team relay target key");
		}
		const envelope: TeamRelayRequestEnvelope = {
			version: TEAM_RELAY_ENVELOPE_VERSION,
			operationId: input.operationId,
			operation: input.operation,
			sourceMachineId: this.machineId,
			sourceRelayKeyId: this.relayKey.keyId,
			targetMachineId: input.targetMachineId,
			targetRelayKeyId: input.targetRelayKey.keyId,
			payload: input.payload,
		};
		if (!isTeamRelayRequestEnvelope(envelope)) {
			throw new Error("Invalid Team relay request envelope");
		}
		return {
			operationId: input.operationId,
			targetMachineId: input.targetMachineId,
			ciphertext: this.cryptoService.encryptTeamRelay(
				envelope,
				input.targetRelayKey,
			),
		};
	}

	openRequest(rawParams: unknown): VerifiedTeamRelayRequest {
		const params = parseTeamRelayExecuteRpcParams(rawParams);
		const envelope = this.decryptRequestEnvelope(params);
		if (
			envelope.operationId !== params.operationId ||
			envelope.sourceMachineId !== params.sourceMachineId ||
			envelope.sourceRelayKeyId !== params.sourceRelayKey.keyId ||
			envelope.targetMachineId !== this.machineId ||
			envelope.targetRelayKeyId !== this.relayKey.keyId
		) {
			throw new Error("Invalid Team relay request binding");
		}
		const verified: VerifiedTeamRelayRequest = {
			operationId: envelope.operationId,
			operation: envelope.operation,
			sourceMachineId: envelope.sourceMachineId,
			sourceRelayKey: params.sourceRelayKey,
			targetMachineId: envelope.targetMachineId,
			payload: envelope.payload,
		};
		this.verifiedRequests.add(verified);
		return verified;
	}

	sealSuccess(
		request: VerifiedTeamRelayRequest,
		value: unknown,
	): TeamRelayExecuteRpcResult {
		return this.sealResponse(request, { ok: true, value });
	}

	sealFailure(
		request: VerifiedTeamRelayRequest,
		error: unknown,
	): TeamRelayExecuteRpcResult {
		return this.sealResponse(request, {
			ok: false,
			error: sanitizeRemoteError(error),
		});
	}

	openResponse(input: OpenTeamRelayResponseInput): unknown {
		if (!isTeamRelayPublicKey(input.targetRelayKey)) {
			throw new Error("Invalid Team relay response binding");
		}
		const envelope = this.decryptResponseEnvelope(input.ciphertext);
		if (
			envelope.operationId !== input.operationId ||
			envelope.operation !== input.operation ||
			envelope.sourceMachineId !== input.targetMachineId ||
			envelope.sourceRelayKeyId !== input.targetRelayKey.keyId ||
			envelope.targetMachineId !== this.machineId ||
			envelope.targetRelayKeyId !== this.relayKey.keyId
		) {
			throw new Error("Invalid Team relay response binding");
		}
		if (!envelope.outcome.ok) {
			throw new TeamRelayRemoteError(envelope.outcome.error);
		}
		return envelope.outcome.value;
	}

	private decryptRequestEnvelope(
		params: TeamRelayExecuteRpcParams,
	): TeamRelayRequestEnvelope {
		let decrypted: unknown;
		try {
			decrypted = this.cryptoService.decryptTeamRelay(params.ciphertext);
		} catch {
			throw new Error("Invalid Team relay request ciphertext");
		}
		if (!isTeamRelayRequestEnvelope(decrypted)) {
			throw new Error("Invalid Team relay request envelope");
		}
		return decrypted;
	}

	private decryptResponseEnvelope(
		ciphertext: TeamRelayCiphertext,
	): TeamRelayResponseEnvelope {
		let decrypted: unknown;
		try {
			decrypted = this.cryptoService.decryptTeamRelay(ciphertext);
		} catch {
			throw new Error("Invalid Team relay response ciphertext");
		}
		if (!isTeamRelayResponseEnvelope(decrypted)) {
			throw new Error("Invalid Team relay response envelope");
		}
		return decrypted;
	}

	private sealResponse(
		request: VerifiedTeamRelayRequest,
		outcome: TeamRelayResponseOutcome,
	): TeamRelayExecuteRpcResult {
		if (
			!this.verifiedRequests.has(request) ||
			request.targetMachineId !== this.machineId
		) {
			throw new Error("Team relay request was not verified by this machine");
		}
		const envelope: TeamRelayResponseEnvelope = {
			version: TEAM_RELAY_ENVELOPE_VERSION,
			operationId: request.operationId,
			operation: request.operation,
			sourceMachineId: this.machineId,
			sourceRelayKeyId: this.relayKey.keyId,
			targetMachineId: request.sourceMachineId,
			targetRelayKeyId: request.sourceRelayKey.keyId,
			outcome,
		};
		if (!isTeamRelayResponseEnvelope(envelope)) {
			throw new Error("Invalid Team relay response envelope");
		}
		return {
			operationId: request.operationId,
			ciphertext: this.cryptoService.encryptTeamRelay(
				envelope,
				request.sourceRelayKey,
			),
		};
	}
}

function sanitizeRemoteError(error: unknown): TeamRelaySafeErrorDetail {
	if (error instanceof AppError) {
		const safeDetail: TeamRelaySafeErrorDetail = {
			code: error.detail.code,
			message: error.detail.message,
			retryable: error.detail.retryable,
			scope: error.detail.scope,
		};
		if (isTeamRelaySafeErrorDetail(safeDetail)) {
			return safeDetail;
		}
	}
	return {
		code: "INTERNAL_ERROR",
		message: "Internal server error",
		retryable: true,
		scope: "request",
	};
}

function isTeamRelayRequestEnvelope(
	value: unknown,
): value is TeamRelayRequestEnvelope {
	return (
		isRecord(value) &&
		hasExactKeys(value, [
			"version",
			"operationId",
			"operation",
			"sourceMachineId",
			"sourceRelayKeyId",
			"targetMachineId",
			"targetRelayKeyId",
			"payload",
		]) &&
		hasValidRoutingEnvelope(value)
	);
}

function isTeamRelayResponseEnvelope(
	value: unknown,
): value is TeamRelayResponseEnvelope {
	return (
		isRecord(value) &&
		hasExactKeys(value, [
			"version",
			"operationId",
			"operation",
			"sourceMachineId",
			"sourceRelayKeyId",
			"targetMachineId",
			"targetRelayKeyId",
			"outcome",
		]) &&
		hasValidRoutingEnvelope(value) &&
		isTeamRelayResponseOutcome(value.outcome)
	);
}

function hasValidRoutingEnvelope(value: Record<string, unknown>): boolean {
	return (
		value.version === TEAM_RELAY_ENVELOPE_VERSION &&
		isBoundedIdentifier(value.operationId, TEAM_RELAY_OPERATION_ID_MAX_BYTES) &&
		typeof value.operation === "string" &&
		OPERATION_SET.has(value.operation) &&
		isBoundedIdentifier(
			value.sourceMachineId,
			TEAM_RELAY_MACHINE_ID_MAX_BYTES,
		) &&
		isBoundedIdentifier(
			value.targetMachineId,
			TEAM_RELAY_MACHINE_ID_MAX_BYTES,
		) &&
		isBoundedIdentifier(value.sourceRelayKeyId, TEAM_RELAY_KEY_ID_MAX_BYTES) &&
		isBoundedIdentifier(value.targetRelayKeyId, TEAM_RELAY_KEY_ID_MAX_BYTES)
	);
}

function isTeamRelayResponseOutcome(
	value: unknown,
): value is TeamRelayResponseOutcome {
	if (!isRecord(value) || typeof value.ok !== "boolean") {
		return false;
	}
	if (value.ok) {
		return hasExactKeys(value, ["ok", "value"]);
	}
	return (
		hasExactKeys(value, ["ok", "error"]) &&
		isTeamRelaySafeErrorDetail(value.error)
	);
}

function isTeamRelaySafeErrorDetail(
	value: unknown,
): value is TeamRelaySafeErrorDetail {
	return (
		isRecord(value) &&
		hasExactKeys(value, ["code", "message", "retryable", "scope"]) &&
		typeof value.code === "string" &&
		ERROR_CODES.has(value.code as ErrorDetail["code"]) &&
		isBoundedText(value.message, TEAM_RELAY_ERROR_MESSAGE_MAX_BYTES) &&
		typeof value.retryable === "boolean" &&
		typeof value.scope === "string" &&
		ERROR_SCOPES.has(value.scope as ErrorDetail["scope"])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	expectedKeys: readonly string[],
): boolean {
	const actualKeys = Object.keys(value);
	return (
		actualKeys.length === expectedKeys.length &&
		expectedKeys.every((key) => Object.hasOwn(value, key))
	);
}

function isBoundedIdentifier(
	value: unknown,
	maxBytes: number,
): value is string {
	return (
		isBoundedText(value, maxBytes) &&
		!/\p{Cc}/u.test(value) &&
		value.trim().length > 0
	);
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxBytes &&
		new TextEncoder().encode(value).byteLength <= maxBytes
	);
}
