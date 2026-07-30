import { sanitizeAcpMessageMeta } from "@mobvibe/shared";
import { logger } from "../lib/logger.js";

type SessionMetaEnvelope = {
	_meta?: unknown;
};

const META_WARNING_WINDOW_MS = 60_000;
const META_WARNINGS_PER_WINDOW = 20;

let metaWarningWindowStartedAt = Date.now();
let metaWarningsInWindow = 0;

export type SanitizedSessionMetaEnvelopes<T> = {
	values: T[];
	rejectedCount: number;
};

export type SanitizedAcpMetaPayload<T> = {
	value: T;
	rejectedCount: number;
};

export const warnSessionMetaSanitization = (
	event: string,
	socketId: string,
	result: { rejectedCount: number },
): void => {
	if (result.rejectedCount === 0) {
		return;
	}

	const now = Date.now();
	if (
		now < metaWarningWindowStartedAt ||
		now - metaWarningWindowStartedAt >= META_WARNING_WINDOW_MS
	) {
		metaWarningWindowStartedAt = now;
		metaWarningsInWindow = 0;
	}
	if (metaWarningsInWindow >= META_WARNINGS_PER_WINDOW) {
		return;
	}
	metaWarningsInWindow += 1;

	logger.warn(
		{
			event,
			socketId,
			reason: "session_meta_rejected",
			rejectedCount: result.rejectedCount,
		},
		"session_meta_sanitization_warning",
	);
};

export const sanitizeAcpMetaPayload = <T>(
	value: T,
): SanitizedAcpMetaPayload<T> => {
	const result = sanitizeAcpMessageMeta(value);
	if (!result.complete) {
		throw new Error("ACP payload must contain plain JSON values");
	}
	return {
		value: result.value,
		rejectedCount: result.rejectedEnvelopes,
	};
};

/**
 * Clone a complete session-envelope batch at the CLI trust boundary. Calling
 * the shared message sanitizer once makes its envelope-count and byte budgets
 * apply atomically across the whole socket/RPC event.
 */
export const sanitizeSessionMetaEnvelopes = <T extends SessionMetaEnvelope>(
	values: readonly T[],
): SanitizedSessionMetaEnvelopes<T> => {
	const result = sanitizeAcpMetaPayload([...values]);
	return {
		values: result.value,
		rejectedCount: result.rejectedCount,
	};
};
