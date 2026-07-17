import {
	AppError,
	createErrorDetail,
	createInternalError,
	type ErrorCode,
	type RpcError,
} from "@mobvibe/shared";

const isHttpErrorStatus = (status: unknown): status is number =>
	typeof status === "number" &&
	Number.isInteger(status) &&
	status >= 400 &&
	status <= 599;

const LEGACY_STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
	REQUEST_VALIDATION_FAILED: 400,
	GIT_WORKTREE_FAILED: 400,
	AUTHORIZATION_FAILED: 403,
	SESSION_NOT_FOUND: 404,
	SESSION_NOT_READY: 409,
	SESSION_BUSY: 409,
	CAPABILITY_NOT_SUPPORTED: 409,
	ACP_PROTOCOL_MISMATCH: 409,
	MESSAGE_OUTCOME_UNKNOWN: 409,
	INSTANCE_AFFINITY_CHANGED: 409,
};

const LEGACY_CAPABILITY_MESSAGES = new Set([
	"Agent does not support session/load capability",
	"Agent does not support session loading",
	"Current agent does not support mode switching",
	"Current agent does not support model switching",
]);

const LEGACY_VALIDATION_MESSAGES = new Set([
	"backendId is required",
	"Invalid backend ID",
	"Invalid mode ID",
	"Invalid model ID",
	"Selected backend does not support image prompts",
]);

const translateLegacyInternalError = (
	error: RpcError,
): AppError | undefined => {
	if (error.code !== "INTERNAL_ERROR" || error.status !== undefined) {
		return undefined;
	}
	if (
		error.message === "Session not found" ||
		error.message.startsWith("Session not found:") ||
		error.message === "Session not found or no working directory"
	) {
		return new AppError(
			createErrorDetail({
				code: "SESSION_NOT_FOUND",
				message: "Session not found",
				retryable: false,
				scope: "session",
			}),
			404,
		);
	}
	if (error.message === "Machine not found") {
		return new AppError(
			createErrorDetail({
				code: "AUTHORIZATION_FAILED",
				message: "Machine not found",
				retryable: false,
				scope: "request",
			}),
			404,
		);
	}
	if (LEGACY_CAPABILITY_MESSAGES.has(error.message)) {
		return new AppError(
			createErrorDetail({
				code: "CAPABILITY_NOT_SUPPORTED",
				message: error.message,
				retryable: false,
				scope: "session",
			}),
			409,
		);
	}
	if (
		LEGACY_VALIDATION_MESSAGES.has(error.message) ||
		error.message.startsWith("Not a git repository:")
	) {
		return new AppError(
			createErrorDetail({
				code: "REQUEST_VALIDATION_FAILED",
				message: error.message,
				retryable: false,
				scope: "request",
			}),
			400,
		);
	}
	return undefined;
};

export const toRpcAppError = (error: RpcError): AppError => {
	const legacyError = translateLegacyInternalError(error);
	if (legacyError) return legacyError;

	const { status, ...detail } = error;
	const publicDetail =
		error.code === "INTERNAL_ERROR" ? createInternalError(error.scope) : detail;
	const publicStatus = isHttpErrorStatus(status)
		? status
		: (LEGACY_STATUS_BY_CODE[error.code] ?? 500);

	return new AppError(publicDetail, publicStatus);
};
