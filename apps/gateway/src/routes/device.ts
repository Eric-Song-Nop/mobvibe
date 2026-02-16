import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Router } from "express";
import { db } from "../db/index.js";
import { deviceKeys } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
	type AuthenticatedRequest,
	getUserId,
	requireDeviceOrSessionAuth,
} from "../middleware/auth.js";
import {
	deleteDeviceById,
	getDevicesForUser,
	updateDeviceName,
} from "../services/db-service.js";

export function setupDeviceRoutes(router: Router) {
	router.use(requireDeviceOrSessionAuth);

	/**
	 * POST /auth/device/register
	 * Register a new device public key for the authenticated user.
	 * Requires a valid session cookie (from email/password sign-in).
	 *
	 * Body: { publicKey: string, contentPublicKey?: string, deviceName?: string }
	 */
	router.post(
		"/auth/device/register",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}

			const { publicKey, contentPublicKey, deviceName } = request.body as {
				publicKey?: string;
				contentPublicKey?: string;
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

			// Validate contentPublicKey if provided (Curve25519, 32 bytes)
			if (contentPublicKey !== undefined) {
				if (typeof contentPublicKey !== "string") {
					response.status(400).json({
						error: "contentPublicKey must be a base64 string",
					});
					return;
				}
				try {
					const decoded = Buffer.from(contentPublicKey, "base64");
					if (decoded.length !== 32) {
						response.status(400).json({
							error: `Invalid content public key length: expected 32 bytes, got ${decoded.length}`,
						});
						return;
					}
				} catch {
					response.status(400).json({
						error: "Invalid base64 encoding for contentPublicKey",
					});
					return;
				}
			}

			try {
				// Check if this public key is already registered
				const existing = await db
					.select({
						id: deviceKeys.id,
						userId: deviceKeys.userId,
						contentPublicKey: deviceKeys.contentPublicKey,
					})
					.from(deviceKeys)
					.where(eq(deviceKeys.publicKey, publicKey))
					.limit(1);

				if (existing.length > 0) {
					if (existing[0].userId === userId) {
						// Same user re-registering same key — update contentPublicKey if provided
						if (
							contentPublicKey &&
							existing[0].contentPublicKey !== contentPublicKey
						) {
							await db
								.update(deviceKeys)
								.set({ contentPublicKey })
								.where(eq(deviceKeys.id, existing[0].id));
						}
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
					contentPublicKey: contentPublicKey ?? null,
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

	/**
	 * GET /auth/device/content-keys
	 * Get all device content public keys for the authenticated user.
	 * Used by CLIs to wrap DEKs for all registered devices.
	 *
	 * Returns: { keys: Array<{ deviceId: string, contentPublicKey: string, deviceName: string | null }> }
	 */
	router.get(
		"/auth/device/content-keys",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}

			try {
				const results = await db
					.select({
						id: deviceKeys.id,
						contentPublicKey: deviceKeys.contentPublicKey,
						deviceName: deviceKeys.deviceName,
					})
					.from(deviceKeys)
					.where(eq(deviceKeys.userId, userId));

				// Only return devices that have a content public key
				const keys = results
					.filter(
						(r): r is typeof r & { contentPublicKey: string } =>
							r.contentPublicKey !== null,
					)
					.map((r) => ({
						deviceId: r.id,
						contentPublicKey: r.contentPublicKey,
						deviceName: r.deviceName,
					}));

				response.json({ keys });
			} catch (error) {
				logger.error({ err: error }, "device_content_keys_error");
				response
					.status(500)
					.json({ error: "Failed to fetch device content keys" });
			}
		},
	);

	/**
	 * GET /auth/device/list
	 * List all registered devices for the authenticated user.
	 *
	 * Returns: { devices: Array<{ id, deviceName, hasContentKey, createdAt, lastSeenAt }> }
	 */
	router.get(
		"/auth/device/list",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}

			try {
				const devices = await getDevicesForUser(userId);
				response.json({
					devices: devices.map((d) => ({
						id: d.id,
						deviceName: d.deviceName,
						hasContentKey: d.contentPublicKey !== null,
						createdAt: d.createdAt.toISOString(),
						lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
					})),
				});
			} catch (error) {
				logger.error({ err: error }, "device_list_error");
				response.status(500).json({ error: "Failed to list devices" });
			}
		},
	);

	/**
	 * DELETE /auth/device/:deviceId
	 * Delete a device by ID.
	 * User can only delete their own devices.
	 *
	 * Returns: { success: true } or { error: string }
	 */
	router.delete(
		"/auth/device/:deviceId",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}

			const { deviceId } = request.params;
			if (!deviceId) {
				response.status(400).json({ error: "Device ID is required" });
				return;
			}

			try {
				const deleted = await deleteDeviceById(deviceId, userId);
				if (!deleted) {
					response.status(404).json({ error: "Device not found" });
					return;
				}

				logger.info({ userId, deviceId }, "device_deleted");
				response.json({ success: true });
			} catch (error) {
				logger.error({ err: error }, "device_delete_error");
				response.status(500).json({ error: "Failed to delete device" });
			}
		},
	);

	/**
	 * PATCH /auth/device/:deviceId
	 * Update a device's name.
	 * User can only update their own devices.
	 *
	 * Body: { deviceName: string }
	 * Returns: { success: true } or { error: string }
	 */
	router.patch(
		"/auth/device/:deviceId",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}

			const { deviceId } = request.params;
			const { deviceName } = request.body as { deviceName?: string };

			if (!deviceId) {
				response.status(400).json({ error: "Device ID is required" });
				return;
			}

			if (!deviceName || typeof deviceName !== "string") {
				response.status(400).json({ error: "deviceName is required" });
				return;
			}

			if (deviceName.length > 100) {
				response
					.status(400)
					.json({ error: "deviceName must be 100 characters or less" });
				return;
			}

			try {
				const updated = await updateDeviceName(deviceId, userId, deviceName);
				if (!updated) {
					response.status(404).json({ error: "Device not found" });
					return;
				}

				logger.info({ userId, deviceId, deviceName }, "device_renamed");
				response.json({ success: true });
			} catch (error) {
				logger.error({ err: error }, "device_rename_error");
				response.status(500).json({ error: "Failed to rename device" });
			}
		},
	);

	return router;
}
