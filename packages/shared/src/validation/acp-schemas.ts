/**
 * ACP Zod Schema Validation Utilities
 *
 * Uses SDK-provided Zod schemas for runtime validation on critical paths:
 * - WAL event backfill recovery
 * - SDK upgrade transition debugging
 * - Error boundary payload capture
 */

import type { SessionNotification } from "@agentclientprotocol/sdk";
import { z } from "zod";

// The SDK validates notifications at the transport boundary but no longer exports
// its generated Zod schemas. WAL recovery only needs a resilient envelope check:
// preserve the complete update payload (including future update variants) while
// rejecting values that cannot be routed as session notifications.
const sessionNotificationSchema = z
	.object({
		sessionId: z.string().min(1),
		update: z
			.object({
				sessionUpdate: z.string().min(1),
			})
			.loose(),
	})
	.loose();

/**
 * Validate a SessionNotification payload (e.g. from WAL backfill).
 * Returns the parsed value on success, or an error on failure.
 */
export function parseSessionNotification(payload: unknown): {
	success: boolean;
	data?: SessionNotification;
	error?: unknown;
} {
	const result = sessionNotificationSchema.safeParse(payload);
	if (result.success) {
		return { success: true, data: result.data as SessionNotification };
	}
	return { success: false, error: result.error };
}
