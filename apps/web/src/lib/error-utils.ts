import i18n from "@/i18n";
import { ApiError, type ErrorDetail } from "./api";

/**
 * Creates a fallback error object with the given message and scope.
 */
export const createFallbackError = (
	message: string,
	scope: ErrorDetail["scope"],
): ErrorDetail => ({
	code: "INTERNAL_ERROR",
	message,
	retryable: true,
	scope,
});

/**
 * Normalizes an error into an ErrorDetail object.
 * If the error is an ApiError, returns its detail.
 * If the error is a generic Error, uses the error message.
 * Otherwise, returns the fallback.
 */
export const normalizeError = (
	error: unknown,
	fallback: ErrorDetail,
): ErrorDetail => {
	if (error instanceof ApiError) {
		return error.detail;
	}
	if (error instanceof Error) {
		return {
			...fallback,
			message: error.message,
			detail: error.message,
		};
	}
	return fallback;
};

/**
 * Type guard to check if a payload is an ErrorDetail object.
 */
export const isErrorDetail = (payload: unknown): payload is ErrorDetail => {
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const detail = payload as ErrorDetail;
	return (
		typeof detail.code === "string" &&
		typeof detail.message === "string" &&
		typeof detail.retryable === "boolean" &&
		typeof detail.scope === "string"
	);
};

/**
 * Creates an ErrorDetail for a disconnected SSE stream.
 */
export const buildStreamDisconnectedError = (): ErrorDetail => ({
	code: "STREAM_DISCONNECTED",
	message: i18n.t("errors.streamDisconnected"),
	retryable: true,
	scope: "stream",
});

/**
 * Creates an ErrorDetail for when a session is not ready.
 */
export const buildSessionNotReadyError = (): ErrorDetail => ({
	code: "SESSION_NOT_READY",
	message: i18n.t("errors.sessionNotReady"),
	retryable: true,
	scope: "session",
});
