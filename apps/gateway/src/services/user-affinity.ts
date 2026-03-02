import type { Redis } from "./redis.js";
import { logger } from "../lib/logger.js";

const USER_KEY_PREFIX = "gw:user:";
const USER_TTL_SECONDS = 300;

export type AffinityRecord = {
	instanceId: string;
	region: string | undefined;
};

export class UserAffinityManager {
	constructor(
		private readonly redis: Redis,
		private readonly instanceId: string,
		private readonly region: string | undefined,
	) {}

	/** Look up which instance owns a user. Returns null if no affinity exists. */
	async getUserInstance(userId: string): Promise<AffinityRecord | null> {
		const raw = await this.redis.get(`${USER_KEY_PREFIX}${userId}`);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as AffinityRecord;
		} catch {
			return null;
		}
	}

	/**
	 * Claim a user for this instance (SET NX).
	 * Returns true if this instance now owns the user,
	 * false if another instance already claimed it.
	 */
	async claimUser(userId: string): Promise<boolean> {
		const key = `${USER_KEY_PREFIX}${userId}`;
		const value = JSON.stringify({
			instanceId: this.instanceId,
			region: this.region,
		});

		// SET NX EX — only set if key does not exist
		const result = await this.redis.set(
			key,
			value,
			"EX",
			USER_TTL_SECONDS,
			"NX",
		);

		if (result === "OK") {
			logger.debug({ userId, instanceId: this.instanceId }, "user_claimed");
			return true;
		}

		// Key exists — check if it's us (idempotent re-claim)
		const existing = await this.getUserInstance(userId);
		if (existing?.instanceId === this.instanceId) {
			// Refresh TTL
			await this.redis.expire(key, USER_TTL_SECONDS);
			return true;
		}

		logger.debug(
			{
				userId,
				ownerInstanceId: existing?.instanceId,
				thisInstanceId: this.instanceId,
			},
			"user_claimed_by_other",
		);
		return false;
	}

	/** Release a user's affinity (only if this instance owns it). */
	async releaseUser(userId: string): Promise<void> {
		const existing = await this.getUserInstance(userId);
		if (existing?.instanceId !== this.instanceId) return;

		await this.redis.del(`${USER_KEY_PREFIX}${userId}`);
		logger.debug({ userId, instanceId: this.instanceId }, "user_released");
	}

	/** Batch-renew TTL for all given user IDs. */
	async renewAll(userIds: string[]): Promise<void> {
		if (userIds.length === 0) return;
		const pipeline = this.redis.pipeline();
		for (const userId of userIds) {
			pipeline.expire(`${USER_KEY_PREFIX}${userId}`, USER_TTL_SECONDS);
		}
		await pipeline.exec();
	}
}
