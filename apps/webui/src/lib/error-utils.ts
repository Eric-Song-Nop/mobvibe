import type { ErrorDetail } from "@mobvibe/shared";
import { isErrorDetail } from "@mobvibe/shared";
import i18n from "@/i18n";

// Re-export isErrorDetail from shared
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
 * Creates an ErrorDetail for when a session is not ready.
 */
export const buildSessionNotReadyError = (): ErrorDetail => ({
	code: "SESSION_NOT_READY",
	message: i18n.t("errors.sessionNotReady"),
	retryable: true,
	scope: "session",
});
