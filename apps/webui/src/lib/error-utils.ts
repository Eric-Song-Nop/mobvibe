import i18n from "@/i18n";
import type { ErrorDetail } from "./api";

// Re-export core error utilities
export {
	createFallbackError,
	normalizeError,
	isErrorDetail,
} from "@remote-claude/core/utils";

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
