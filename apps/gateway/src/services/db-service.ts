/**
 * Database service for Gateway server.
 * Provides methods to validate tokens and manage machine/session data.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { acpSessions, deviceKeys, machines } from "../db/schema.js";
import { logger } from "../lib/logger.js";

/**
 * Find a device key record by its public key.
 */
export async function findDeviceByPublicKey(
	publicKey: string,
): Promise<{ id: string; userId: string } | null> {
	try {
		const result = await db
			.select({ id: deviceKeys.id, userId: deviceKeys.userId })
			.from(deviceKeys)
			.where(eq(deviceKeys.publicKey, publicKey))
			.limit(1);

		if (result.length === 0) {
			return null;
		}

		// Update lastSeenAt
		await db
			.update(deviceKeys)
			.set({ lastSeenAt: new Date() })
			.where(eq(deviceKeys.id, result[0].id));

		return result[0];
	} catch (error) {
		logger.error({ err: error }, "db_find_device_by_public_key_error");
		return null;
	}
}

/**
 * Get all device content public keys for a user (for multi-device DEK wrapping).
 */
export async function getDeviceContentKeysForUser(
	userId: string,
): Promise<Array<{ deviceId: string; contentPublicKey: string }>> {
	try {
		const results = await db
			.select({
				id: deviceKeys.id,
				contentPublicKey: deviceKeys.contentPublicKey,
			})
			.from(deviceKeys)
			.where(eq(deviceKeys.userId, userId));

		return results
			.filter(
				(r): r is { id: string; contentPublicKey: string } =>
					r.contentPublicKey !== null,
			)
			.map((r) => ({
				deviceId: r.id,
				contentPublicKey: r.contentPublicKey,
			}));
	} catch (error) {
		logger.error({ err: error }, "db_get_device_content_keys_error");
		return [];
	}
}

export type MachineTokenValidation = {
	machineId: string;
	userId: string;
	name: string;
	hostname: string;
};

export type SessionOwnershipCheck = {
	exists: boolean;
	isOwner: boolean;
};

/**
 * Validate a machine token and get machine/user info.
 * Returns null if token is invalid.
 */
export async function validateMachineToken(
	machineToken: string,
): Promise<MachineTokenValidation | null> {
	try {
		const result = await db
			.select({
				id: machines.id,
				userId: machines.userId,
				name: machines.name,
				hostname: machines.hostname,
			})
			.from(machines)
			.where(eq(machines.machineToken, machineToken))
			.limit(1);

		if (result.length === 0) {
			return null;
		}

		const machine = result[0];
		return {
			machineId: machine.id,
			userId: machine.userId,
			name: machine.name,
			hostname: machine.hostname,
		};
	} catch (error) {
		logger.error({ err: error }, "db_validate_machine_token_error");
		return null;
	}
}

/**
 * Update machine online status.
 */
export async function updateMachineStatus(
	machineToken: string,
	isOnline: boolean,
): Promise<{ machineId: string; userId: string } | null> {
	try {
		const result = await db
			.update(machines)
			.set({
				isOnline,
				lastSeenAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(machines.machineToken, machineToken))
			.returning({ id: machines.id, userId: machines.userId });

		if (result.length === 0) {
			return null;
		}

		return { machineId: result[0].id, userId: result[0].userId };
	} catch (error) {
		logger.error({ err: error }, "db_update_machine_status_error");
		return null;
	}
}

/**
 * Create a session record in the database.
 */
export async function createAcpSession(params: {
	machineToken: string;
	sessionId: string;
	title: string;
	backendId: string;
	cwd?: string;
}): Promise<{ _id: string; userId: string; machineId: string } | null> {
	try {
		// First, get the machine info from the token
		const machineResult = await db
			.select({ id: machines.id, userId: machines.userId })
			.from(machines)
			.where(eq(machines.machineToken, params.machineToken))
			.limit(1);

		if (machineResult.length === 0) {
			logger.warn(
				{ machineToken: params.machineToken },
				"db_create_session_machine_not_found",
			);
			return null;
		}

		const machine = machineResult[0];
		const id = randomUUID();

		await db.insert(acpSessions).values({
			id,
			sessionId: params.sessionId,
			userId: machine.userId,
			machineId: machine.id,
			title: params.title,
			backendId: params.backendId,
			cwd: params.cwd ?? null,
			state: "active",
		});

		return {
			_id: id,
			userId: machine.userId,
			machineId: machine.id,
		};
	} catch (error) {
		logger.error({ err: error }, "db_create_session_error");
		return null;
	}
}

/**
 * Update a session's state in the database.
 */
export async function updateAcpSessionState(params: {
	sessionId: string;
	state: string;
	title?: string;
	cwd?: string;
}): Promise<boolean> {
	try {
		const updateData: Record<string, unknown> = {
			state: params.state,
			updatedAt: new Date(),
		};

		if (params.title !== undefined) {
			updateData.title = params.title;
		}
		if (params.cwd !== undefined) {
			updateData.cwd = params.cwd;
		}

		await db
			.update(acpSessions)
			.set(updateData)
			.where(eq(acpSessions.sessionId, params.sessionId));

		return true;
	} catch (error) {
		logger.error({ err: error }, "db_update_session_state_error");
		return false;
	}
}

/**
 * Close a session in the database.
 */
export async function closeAcpSession(sessionId: string): Promise<boolean> {
	try {
		await db
			.update(acpSessions)
			.set({
				state: "closed",
				closedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(acpSessions.sessionId, sessionId));

		return true;
	} catch (error) {
		logger.error({ err: error }, "db_close_session_error");
		return false;
	}
}

/**
 * Check if a user owns a session.
 */
export async function checkSessionOwnership(
	sessionId: string,
	userId: string,
): Promise<SessionOwnershipCheck> {
	try {
		const result = await db
			.select({ userId: acpSessions.userId })
			.from(acpSessions)
			.where(eq(acpSessions.sessionId, sessionId))
			.limit(1);

		if (result.length === 0) {
			return { exists: false, isOwner: false };
		}

		return {
			exists: true,
			isOwner: result[0].userId === userId,
		};
	} catch (error) {
		logger.error({ err: error }, "db_check_session_ownership_error");
		return { exists: false, isOwner: false };
	}
}

/**
 * Close all sessions for a machine (on disconnect).
 * @deprecated Use closeSessionsForMachineById instead
 */
export async function closeSessionsForMachine(
	machineToken: string,
): Promise<number> {
	try {
		// First get the machine ID from the token
		const machineResult = await db
			.select({ id: machines.id })
			.from(machines)
			.where(eq(machines.machineToken, machineToken))
			.limit(1);

		if (machineResult.length === 0) {
			return 0;
		}

		const machineId = machineResult[0].id;

		// Close all active sessions for this machine
		const result = await db
			.update(acpSessions)
			.set({
				state: "closed",
				closedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(acpSessions.machineId, machineId),
					eq(acpSessions.state, "active"),
				),
			)
			.returning({ id: acpSessions.id });

		return result.length;
	} catch (error) {
		logger.error({ err: error }, "db_close_sessions_for_machine_error");
		return 0;
	}
}

/**
 * Close all sessions for a machine by machineId (on disconnect).
 */
export async function closeSessionsForMachineById(
	machineId: string,
): Promise<number> {
	try {
		const result = await db
			.update(acpSessions)
			.set({
				state: "closed",
				closedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(acpSessions.machineId, machineId),
					eq(acpSessions.state, "active"),
				),
			)
			.returning({ id: acpSessions.id });

		return result.length;
	} catch (error) {
		logger.error({ err: error }, "db_close_sessions_for_machine_by_id_error");
		return 0;
	}
}

/**
 * Create or update a machine record.
 * Prefers legacy raw machineId for the same user; otherwise uses a user-scoped id.
 */
const buildUserScopedMachineId = (
	userId: string,
	rawMachineId: string,
): string => `${userId}:${rawMachineId}`;

export async function upsertMachine(params: {
	rawMachineId: string;
	userId: string;
	name: string;
	hostname: string;
	platform?: string;
	isOnline?: boolean;
}): Promise<{ machineId: string; userId: string } | null> {
	try {
		// Prefer legacy machineId (raw) if it already belongs to this user
		const legacyMatch = await db
			.select({ id: machines.id, userId: machines.userId })
			.from(machines)
			.where(
				and(
					eq(machines.id, params.rawMachineId),
					eq(machines.userId, params.userId),
				),
			)
			.limit(1);

		const resolvedMachineId =
			legacyMatch.length > 0
				? params.rawMachineId
				: buildUserScopedMachineId(params.userId, params.rawMachineId);

		const existing =
			resolvedMachineId === params.rawMachineId
				? legacyMatch
				: await db
						.select({ id: machines.id, userId: machines.userId })
						.from(machines)
						.where(eq(machines.id, resolvedMachineId))
						.limit(1);

		if (existing.length > 0) {
			// Machine exists - verify it belongs to the same user
			if (existing[0].userId !== params.userId) {
				logger.warn(
					{ machineId: resolvedMachineId, userId: params.userId },
					"db_upsert_machine_user_mismatch",
				);

				return null;
			}

			// Update existing machine
			await db
				.update(machines)
				.set({
					name: params.name,
					hostname: params.hostname,
					platform: params.platform ?? null,
					isOnline: params.isOnline ?? true,
					lastSeenAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(machines.id, resolvedMachineId));

			return { machineId: resolvedMachineId, userId: params.userId };
		}

		// Create new machine
		// Generate a placeholder machineToken for backwards compatibility
		const placeholderToken = `api_${resolvedMachineId.replace(/-/g, "")}`;

		await db.insert(machines).values({
			id: resolvedMachineId,
			userId: params.userId,
			name: params.name,
			hostname: params.hostname,
			platform: params.platform ?? null,
			machineToken: placeholderToken,
			isOnline: params.isOnline ?? true,
			lastSeenAt: new Date(),
		});

		return { machineId: resolvedMachineId, userId: params.userId };
	} catch (error) {
		logger.error({ err: error }, "db_upsert_machine_error");
		return null;
	}
}

/**
 * Update machine online status by machineId.
 */
export async function updateMachineStatusById(
	machineId: string,
	isOnline: boolean,
): Promise<boolean> {
	try {
		await db
			.update(machines)
			.set({
				isOnline,
				lastSeenAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(machines.id, machineId));

		return true;
	} catch (error) {
		logger.error({ err: error }, "db_update_machine_status_by_id_error");
		return false;
	}
}

/**
 * Create a session record with explicit userId and machineId.
 */
export async function createAcpSessionDirect(params: {
	userId: string;
	machineId: string;
	sessionId: string;
	title: string;
	backendId: string;
	cwd?: string;
	wrappedDek?: string;
	wrappedDeks?: Record<string, string>;
}): Promise<{ _id: string } | null> {
	const isUniqueViolation = (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "23505";

	try {
		const id = randomUUID();

		// Store wrappedDeks as JSON if provided, fall back to legacy wrappedDek
		const wrappedDekValue = params.wrappedDeks
			? JSON.stringify(params.wrappedDeks)
			: (params.wrappedDek ?? null);

		await db.insert(acpSessions).values({
			id,
			sessionId: params.sessionId,
			userId: params.userId,
			machineId: params.machineId,
			title: params.title,
			backendId: params.backendId,
			cwd: params.cwd ?? null,
			wrappedDek: wrappedDekValue,
			state: "active",
		});

		return { _id: id };
	} catch (error) {
		if (!isUniqueViolation(error)) {
			logger.error({ err: error }, "db_create_session_direct_error");
			return null;
		}

		try {
			const existing = await db
				.select({
					id: acpSessions.id,
					userId: acpSessions.userId,
					machineId: acpSessions.machineId,
				})
				.from(acpSessions)
				.where(eq(acpSessions.sessionId, params.sessionId))
				.limit(1);

			if (existing.length === 0) {
				logger.error(
					{ err: error, sessionId: params.sessionId },
					"db_create_session_direct_conflict_missing",
				);
				return null;
			}

			const record = existing[0];
			if (
				record.userId !== params.userId ||
				record.machineId !== params.machineId
			) {
				logger.error(
					{
						sessionId: params.sessionId,
						userId: params.userId,
						machineId: params.machineId,
						existingUserId: record.userId,
						existingMachineId: record.machineId,
					},
					"db_create_session_direct_conflict_owner_mismatch",
				);
				return null;
			}

			const updateData: Record<string, unknown> = {
				title: params.title,
				backendId: params.backendId,
				state: "active",
				updatedAt: new Date(),
				closedAt: null,
			};

			if (params.cwd !== undefined) {
				updateData.cwd = params.cwd ?? null;
			}

			await db
				.update(acpSessions)
				.set(updateData)
				.where(eq(acpSessions.sessionId, params.sessionId));

			return { _id: record.id };
		} catch (retryError) {
			logger.error(
				{ err: retryError, sessionId: params.sessionId },
				"db_create_session_direct_retry_error",
			);
			return null;
		}
	}
}
