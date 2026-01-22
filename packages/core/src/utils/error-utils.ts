import type { ErrorDetail } from "../api/types";
import { isErrorDetail } from "../api/types";

// Re-export isErrorDetail from shared (already exported via api/types)
export { isErrorDetail };

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
	// Duck-type check for ApiError-like objects (works across module boundaries)
	if (
		error instanceof Error &&
		"detail" in error &&
		isErrorDetail((error as { detail: unknown }).detail)
	) {
		return (error as { detail: ErrorDetail }).detail;
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
 * Creates an ErrorDetail for a disconnected SSE stream.
 */
export const buildStreamDisconnectedError = (message: string): ErrorDetail => ({
	code: "STREAM_DISCONNECTED",
	message,
	retryable: true,
	scope: "stream",
});

/**
 * Creates an ErrorDetail for when a session is not ready.
 */
export const buildSessionNotReadyError = (message: string): ErrorDetail => ({
	code: "SESSION_NOT_READY",
	message,
	retryable: true,
	scope: "session",
});
