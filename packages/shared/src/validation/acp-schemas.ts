/**
 * ACP Zod Schema Validation Utilities
 *
 * Uses SDK-provided Zod schemas for runtime validation on critical paths:
 * - WAL event backfill recovery
 * - SDK upgrade transition debugging
 * - Error boundary payload capture
 */

import { zSessionNotification } from "@agentclientprotocol/sdk/dist/schema/zod.gen.js";

/**
 * Validate a SessionNotification payload (e.g. from WAL backfill).
 * Returns the parsed value on success, or an error on failure.
 */
export function parseSessionNotification(payload: unknown): {
	success: boolean;
	data?: unknown;
	error?: unknown;
} {
	const result = zSessionNotification.safeParse(payload);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return { success: false, error: result.error };
}
