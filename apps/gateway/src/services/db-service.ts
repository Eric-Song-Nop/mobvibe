/**
 * Database service for Gateway server.
 * Provides methods to validate tokens and manage machine/session data.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { deviceKeys, machines } from "../db/schema.js";
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

export type MachineTokenValidation = {
	machineId: string;
	userId: string;
	name: string;
	hostname: string;
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
}): Promise<{ machineId: string; userId: string } | null> {
	try {
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
			if (existing[0].userId !== params.userId) {
				logger.warn(
					{ machineId: resolvedMachineId, userId: params.userId },
					"db_upsert_machine_user_mismatch",
				);

				return null;
			}

			await db
				.update(machines)
				.set({
					name: params.name,
					hostname: params.hostname,
					platform: params.platform ?? null,
					lastSeenAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(machines.id, resolvedMachineId));

			return { machineId: resolvedMachineId, userId: params.userId };
		}

		const placeholderToken = `api_${resolvedMachineId.replace(/-/g, "")}`;

		await db.insert(machines).values({
			id: resolvedMachineId,
			userId: params.userId,
			name: params.name,
			hostname: params.hostname,
			platform: params.platform ?? null,
			machineToken: placeholderToken,
			lastSeenAt: new Date(),
		});

		return { machineId: resolvedMachineId, userId: params.userId };
	} catch (error) {
		logger.error({ err: error }, "db_upsert_machine_error");
		return null;
	}
}
