import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Router } from "express";
import { db } from "../db/index.js";
import { deviceKeys } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
	type AuthenticatedRequest,
	getUserId,
	requireAuth,
} from "../middleware/auth.js";

export function setupDeviceRoutes(router: Router) {
	router.use(requireAuth);

	/**
	 * POST /auth/device/register
	 * Register a new device public key for the authenticated user.
	 * Requires a valid session cookie (from email/password sign-in).
	 */
	router.post(
		"/auth/device/register",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}

			const { publicKey, deviceName } = request.body as {
				publicKey?: string;
				deviceName?: string;
			};

			if (!publicKey || typeof publicKey !== "string") {
				response
					.status(400)
					.json({ error: "publicKey is required (base64 string)" });
				return;
			}

			// Validate base64 and Ed25519 public key length (32 bytes)
			try {
				const decoded = Buffer.from(publicKey, "base64");
				if (decoded.length !== 32) {
					response.status(400).json({
						error: `Invalid public key length: expected 32 bytes, got ${decoded.length}`,
					});
					return;
				}
			} catch {
				response
					.status(400)
					.json({ error: "Invalid base64 encoding for publicKey" });
				return;
			}

			try {
				// Check if this public key is already registered
				const existing = await db
					.select({ id: deviceKeys.id, userId: deviceKeys.userId })
					.from(deviceKeys)
					.where(eq(deviceKeys.publicKey, publicKey))
					.limit(1);

				if (existing.length > 0) {
					if (existing[0].userId === userId) {
						// Same user re-registering same key — idempotent success
						response.json({
							success: true,
							deviceId: existing[0].id,
						});
						return;
					}
					// Different user — reject
					response.status(409).json({ error: "Public key already registered" });
					return;
				}

				const deviceId = randomUUID();
				await db.insert(deviceKeys).values({
					id: deviceId,
					userId,
					publicKey,
					deviceName: deviceName ?? null,
				});

				logger.info({ userId, deviceId, deviceName }, "device_key_registered");
				response.json({ success: true, deviceId });
			} catch (error) {
				logger.error({ err: error }, "device_register_error");
				response.status(500).json({ error: "Failed to register device" });
			}
		},
	);

	return router;
}
