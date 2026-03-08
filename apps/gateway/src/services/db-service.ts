import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { deviceKeys, machines, webPushSubscriptions } from "../db/schema.js";
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

export type UpsertWebPushSubscriptionParams = {
	userId: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	userAgent?: string;
	locale?: string;
};

export async function upsertWebPushSubscription(
	params: UpsertWebPushSubscriptionParams,
): Promise<void> {
	try {
		const now = new Date();
		await db
			.insert(webPushSubscriptions)
			.values({
				id: randomUUID(),
				userId: params.userId,
				endpoint: params.endpoint,
				p256dh: params.p256dh,
				auth: params.auth,
				userAgent: params.userAgent ?? null,
				locale: params.locale ?? null,
				createdAt: now,
				updatedAt: now,
				lastSeenAt: now,
			})
			.onConflictDoUpdate({
				target: webPushSubscriptions.endpoint,
				set: {
					userId: params.userId,
					p256dh: params.p256dh,
					auth: params.auth,
					userAgent: params.userAgent ?? null,
					locale: params.locale ?? null,
					updatedAt: now,
					lastSeenAt: now,
				},
			});
	} catch (error) {
		logger.error({ err: error }, "db_upsert_web_push_subscription_error");
		throw error;
	}
}

export async function listWebPushSubscriptionsForUser(userId: string): Promise<
	Array<{
		id: string;
		endpoint: string;
		p256dh: string;
		auth: string;
		locale: string | null;
	}>
> {
	try {
		return await db
			.select({
				id: webPushSubscriptions.id,
				endpoint: webPushSubscriptions.endpoint,
				p256dh: webPushSubscriptions.p256dh,
				auth: webPushSubscriptions.auth,
				locale: webPushSubscriptions.locale,
			})
			.from(webPushSubscriptions)
			.where(eq(webPushSubscriptions.userId, userId));
	} catch (error) {
		logger.error({ err: error }, "db_list_web_push_subscriptions_error");
		return [];
	}
}

export async function deleteWebPushSubscription(
	userId: string,
	endpoint: string,
): Promise<void> {
	try {
		await db
			.delete(webPushSubscriptions)
			.where(
				and(
					eq(webPushSubscriptions.userId, userId),
					eq(webPushSubscriptions.endpoint, endpoint),
				),
			);
	} catch (error) {
		logger.error({ err: error }, "db_delete_web_push_subscription_error");
		throw error;
	}
}

export async function deleteWebPushSubscriptionByEndpoint(
	endpoint: string,
): Promise<void> {
	try {
		await db
			.delete(webPushSubscriptions)
			.where(eq(webPushSubscriptions.endpoint, endpoint));
	} catch (error) {
		logger.error(
			{ err: error },
			"db_delete_web_push_subscription_by_endpoint_error",
		);
	}
}
