import { createHash } from "node:crypto";
import {
	AppError,
	createErrorDetail,
	isErrorDetail,
	type TeamRelayExecuteRpcResult,
} from "@mobvibe/shared";
import type {
	TeamRelayOperation,
	TeamRelayProtocol,
	TeamRelaySafeErrorDetail,
	VerifiedTeamRelayRequest,
} from "./team-relay-protocol.js";
import type {
	TeamRelayOperationClaim,
	TeamRelayStore,
} from "./team-relay-store.js";

export type TeamRelayOperationHandler = (
	request: VerifiedTeamRelayRequest,
) => Promise<unknown>;

export type TeamRelayOperationHandlers = Partial<
	Record<TeamRelayOperation, TeamRelayOperationHandler>
>;

type TeamRelayEndpointOptions = {
	protocol: TeamRelayProtocol;
	store: TeamRelayStore;
	handlers: TeamRelayOperationHandlers;
};

type ClaimedRelayOperation = Extract<
	TeamRelayOperationClaim,
	{ status: "claimed" }
>;

export class TeamRelayEndpoint {
	private readonly protocol: TeamRelayProtocol;
	private readonly store: TeamRelayStore;
	private readonly handlers: TeamRelayOperationHandlers;

	constructor(options: TeamRelayEndpointOptions) {
		this.protocol = options.protocol;
		this.store = options.store;
		this.handlers = options.handlers;
	}

	static digestRequest(
		request: VerifiedTeamRelayRequest,
		targetRelayKeyId: string,
	): string {
		return createHash("sha256")
			.update(
				canonicalJson({
					operationId: request.operationId,
					operation: request.operation,
					sourceMachineId: request.sourceMachineId,
					sourceRelayKeyId: request.sourceRelayKey.keyId,
					targetMachineId: request.targetMachineId,
					targetRelayKeyId,
					payload: request.payload,
				}),
			)
			.digest("hex");
	}

	async handle(rawParams: unknown): Promise<TeamRelayExecuteRpcResult> {
		const request = this.protocol.openRequest(rawParams);
		let requestDigest: string;
		try {
			requestDigest = TeamRelayEndpoint.digestRequest(
				request,
				this.protocol.relayKey.keyId,
			);
		} catch {
			return this.protocol.sealFailure(
				request,
				createInvalidRequestError("Invalid Team relay operation payload"),
			);
		}

		let claim: TeamRelayOperationClaim;
		try {
			claim = this.store.claimOperation({
				sourceMachineId: request.sourceMachineId,
				operationId: request.operationId,
				requestDigest,
			});
		} catch (error) {
			return this.protocol.sealFailure(request, error);
		}
		return this.resolveClaim({ request, requestDigest, claim });
	}

	private async resolveClaim(input: {
		request: VerifiedTeamRelayRequest;
		requestDigest: string;
		claim: TeamRelayOperationClaim;
	}): Promise<TeamRelayExecuteRpcResult> {
		switch (input.claim.status) {
			case "completed":
				return this.protocol.sealSuccess(input.request, input.claim.result);
			case "failed":
				return this.protocol.sealFailure(
					input.request,
					new AppError(parseStoredError(input.claim.error)),
				);
			case "in_progress":
				return this.protocol.sealFailure(input.request, outcomeUnknownError());
			case "conflict":
				return this.protocol.sealFailure(
					input.request,
					createInvalidRequestError("Conflicting Team relay operation payload"),
				);
			case "claimed":
				return this.executeClaimed({
					request: input.request,
					requestDigest: input.requestDigest,
					claim: input.claim,
				});
		}
	}

	private async executeClaimed(input: {
		request: VerifiedTeamRelayRequest;
		requestDigest: string;
		claim: ClaimedRelayOperation;
	}): Promise<TeamRelayExecuteRpcResult> {
		const handler = this.handlers[input.request.operation];
		if (!handler) {
			return this.persistFailure(
				input,
				new AppError(
					createErrorDetail({
						code: "CAPABILITY_NOT_SUPPORTED",
						message: "Team relay operation is not supported",
						retryable: false,
						scope: "request",
					}),
					501,
				),
			);
		}

		let result: unknown;
		try {
			result = await handler(input.request);
		} catch (error) {
			return this.persistFailure(input, error);
		}
		try {
			const durableResult = this.store.completeOperation({
				sourceMachineId: input.request.sourceMachineId,
				operationId: input.request.operationId,
				requestDigest: input.requestDigest,
				claimId: input.claim.claimId,
				result,
			});
			return this.protocol.sealSuccess(input.request, durableResult);
		} catch {
			return this.protocol.sealFailure(input.request, outcomeUnknownError());
		}
	}

	private persistFailure(
		input: {
			request: VerifiedTeamRelayRequest;
			requestDigest: string;
			claim: ClaimedRelayOperation;
		},
		error: unknown,
	): TeamRelayExecuteRpcResult {
		const safeError = sanitizeStoredError(error);
		try {
			this.store.failOperation({
				sourceMachineId: input.request.sourceMachineId,
				operationId: input.request.operationId,
				requestDigest: input.requestDigest,
				claimId: input.claim.claimId,
				error: safeError,
			});
			return this.protocol.sealFailure(input.request, new AppError(safeError));
		} catch {
			return this.protocol.sealFailure(input.request, outcomeUnknownError());
		}
	}
}

function createInvalidRequestError(message: string): AppError {
	return new AppError(
		createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message,
			retryable: false,
			scope: "request",
		}),
		400,
	);
}

function outcomeUnknownError(): AppError {
	return new AppError(
		createErrorDetail({
			code: "MESSAGE_OUTCOME_UNKNOWN",
			message: "Team relay operation outcome is unknown",
			retryable: false,
			scope: "request",
		}),
		409,
	);
}

function sanitizeStoredError(error: unknown): TeamRelaySafeErrorDetail {
	if (error instanceof AppError) {
		return {
			code: error.detail.code,
			message: error.detail.message,
			retryable: error.detail.retryable,
			scope: error.detail.scope,
		};
	}
	return {
		code: "INTERNAL_ERROR",
		message: "Internal server error",
		retryable: true,
		scope: "request",
	};
}

function parseStoredError(value: unknown): TeamRelaySafeErrorDetail {
	if (
		isRecord(value) &&
		hasExactKeys(value, ["code", "message", "retryable", "scope"]) &&
		isErrorDetail(value)
	) {
		return value;
	}
	return sanitizeStoredError(undefined);
}

function canonicalJson(value: unknown): string {
	const ancestors = new Set<object>();
	return serializeCanonical(value, ancestors);
}

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Invalid JSON number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return serializeComposite(value, ancestors, () =>
			value.map((item) => serializeCanonical(item, ancestors)).join(","),
		);
	}
	if (isRecord(value)) {
		return serializeComposite(value, ancestors, () =>
			Object.keys(value)
				.sort()
				.map(
					(key) =>
						`${JSON.stringify(key)}:${serializeCanonical(value[key], ancestors)}`,
				)
				.join(","),
		);
	}
	throw new Error("Value is not JSON-serializable");
}

function serializeComposite(
	value: object,
	ancestors: Set<object>,
	serializeContents: () => string,
): string {
	if (ancestors.has(value)) throw new Error("Cyclic JSON value");
	ancestors.add(value);
	try {
		const contents = serializeContents();
		return Array.isArray(value) ? `[${contents}]` : `{${contents}}`;
	} finally {
		ancestors.delete(value);
	}
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
