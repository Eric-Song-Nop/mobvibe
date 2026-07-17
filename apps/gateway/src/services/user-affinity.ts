import { logger } from "../lib/logger.js";
import type { Redis } from "./redis.js";

const USER_KEY_PREFIX = "gw:user:";
const USER_TTL_SECONDS = 300;
const CLAIM_OR_REFRESH_SCRIPT = `
local existing = redis.call("get", KEYS[1])
if not existing or existing == ARGV[1] then
	redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[2])
	return 1
end
return 0
`;
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
	return redis.call("del", KEYS[1])
end
return 0
`;
const RENEW_OR_RECOVER_SCRIPT = `
local existing = redis.call("get", KEYS[1])
if not existing then
	redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[2])
	return 1
end
if existing == ARGV[1] then
	redis.call("expire", KEYS[1], ARGV[2])
	return 2
end
return 0
`;

export type AffinityRecord = {
	instanceId: string;
	region: string | undefined;
};

export type UserAffinityProvider = () => UserAffinityManager | null;

export class UserAffinityManager {
	private readonly ownedUserIds = new Set<string>();
	private readonly inactiveOwnedUserDeadlines = new Map<string, number>();
	private readonly inFlightOwnershipOperations = new Set<Promise<unknown>>();
	private ownershipChangesOpen = true;

	constructor(
		private readonly redis: Redis,
		private readonly instanceId: string,
		private readonly region: string | undefined,
	) {}

	private ownerValue(): string {
		return JSON.stringify({
			instanceId: this.instanceId,
			region: this.region,
		});
	}

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

	/** Claim or refresh a user atomically if no other instance owns it. */
	async claimUser(userId: string): Promise<boolean> {
		return this.runOwnershipOperation(
			() => this.claimUserWhileOpen(userId),
			false,
		);
	}

	private async claimUserWhileOpen(userId: string): Promise<boolean> {
		const key = `${USER_KEY_PREFIX}${userId}`;
		const value = this.ownerValue();
		const result = await this.redis.eval(
			CLAIM_OR_REFRESH_SCRIPT,
			1,
			key,
			value,
			USER_TTL_SECONDS,
		);

		if (result === 1) {
			this.ownedUserIds.add(userId);
			this.inactiveOwnedUserDeadlines.delete(userId);
			logger.debug({ userId, instanceId: this.instanceId }, "user_claimed");
			return true;
		}

		const existing = await this.getUserInstance(userId);
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

	private runOwnershipOperation<T>(
		operation: () => Promise<T>,
		closedResult: T,
	): Promise<T> {
		if (!this.ownershipChangesOpen) return Promise.resolve(closedResult);

		const result = operation();
		this.inFlightOwnershipOperations.add(result);
		const clear = () => this.inFlightOwnershipOperations.delete(result);
		void result.then(clear, clear);
		return result;
	}

	/** Release a user's affinity (only if this instance owns it). */
	async releaseUser(userId: string): Promise<void> {
		const released = await this.redis.eval(
			RELEASE_IF_OWNER_SCRIPT,
			1,
			`${USER_KEY_PREFIX}${userId}`,
			this.ownerValue(),
		);
		if (released === 1) {
			logger.debug({ userId, instanceId: this.instanceId }, "user_released");
		}
		this.ownedUserIds.delete(userId);
		this.inactiveOwnedUserDeadlines.delete(userId);
	}

	/** Release every affinity this process successfully claimed, preserving new owners. */
	async releaseAllOwnedUsers(): Promise<void> {
		const userIds = Array.from(this.ownedUserIds);
		await this.releaseOwnedUsers(userIds);
	}

	private async releaseOwnedUsers(userIds: string[]): Promise<void> {
		if (userIds.length === 0) return;

		const pipeline = this.redis.pipeline();
		const ownerValue = this.ownerValue();
		for (const userId of userIds) {
			pipeline.eval(
				RELEASE_IF_OWNER_SCRIPT,
				1,
				`${USER_KEY_PREFIX}${userId}`,
				ownerValue,
			);
		}
		const results = await pipeline.exec();
		if (!results) {
			logger.warn(
				{ instanceId: this.instanceId, userCount: userIds.length },
				"affinity_release_pipeline_aborted",
			);
			return;
		}

		for (const [index, result] of results.entries()) {
			const userId = userIds[index];
			const [error, released] = result;
			if (error) {
				logger.warn(
					{ err: error, userId, instanceId: this.instanceId },
					"affinity_release_command_failed",
				);
				continue;
			}
			this.ownedUserIds.delete(userId);
			this.inactiveOwnedUserDeadlines.delete(userId);
			if (released === 1) {
				logger.debug({ userId, instanceId: this.instanceId }, "user_released");
			}
		}
	}

	/** Stop ownership changes, drain operations already in flight, then release. */
	async shutdownAndReleaseAllOwnedUsers(): Promise<void> {
		this.ownershipChangesOpen = false;
		const pendingOperations = Array.from(this.inFlightOwnershipOperations);
		if (pendingOperations.length > 0) {
			await Promise.allSettled(pendingOperations);
		}
		await this.releaseAllOwnedUsers();
	}

	/** Batch-renew TTLs and return only users owned by another instance. */
	async renewAll(userIds: string[]): Promise<string[]> {
		return this.runOwnershipOperation(
			() => this.renewAllWhileOpen(userIds),
			[],
		);
	}

	private async renewAllWhileOpen(userIds: string[]): Promise<string[]> {
		const activeUserIds = new Set(userIds);
		const now = Date.now();
		for (const ownedUserId of this.ownedUserIds) {
			if (activeUserIds.has(ownedUserId)) {
				this.inactiveOwnedUserDeadlines.delete(ownedUserId);
				continue;
			}

			const deadline = this.inactiveOwnedUserDeadlines.get(ownedUserId);
			if (deadline === undefined) {
				// Stop renewing an inactive lease, but retain it long enough for a
				// graceful shutdown to release it. Redis expires it at the same deadline.
				this.inactiveOwnedUserDeadlines.set(
					ownedUserId,
					now + USER_TTL_SECONDS * 1_000,
				);
			} else if (deadline <= now) {
				this.inactiveOwnedUserDeadlines.delete(ownedUserId);
				this.ownedUserIds.delete(ownedUserId);
			}
		}
		const activeUsers = Array.from(activeUserIds);
		if (activeUsers.length === 0) return [];
		const pipeline = this.redis.pipeline();
		const ownerValue = this.ownerValue();
		for (const userId of activeUsers) {
			pipeline.eval(
				RENEW_OR_RECOVER_SCRIPT,
				1,
				`${USER_KEY_PREFIX}${userId}`,
				ownerValue,
				USER_TTL_SECONDS,
			);
		}
		const results = await pipeline.exec();
		if (!results) {
			logger.warn(
				{ instanceId: this.instanceId, userCount: activeUsers.length },
				"affinity_renew_pipeline_aborted",
			);
			return [];
		}

		const conflicts: string[] = [];
		for (const [index, result] of results.entries()) {
			const userId = activeUsers[index];
			const [error, status] = result;
			if (error) {
				logger.warn(
					{ err: error, userId, instanceId: this.instanceId },
					"affinity_renew_command_failed",
				);
				continue;
			}
			if (status === 0) {
				this.ownedUserIds.delete(userId);
				this.inactiveOwnedUserDeadlines.delete(userId);
				conflicts.push(userId);
				logger.warn(
					{ userId, instanceId: this.instanceId },
					"affinity_renew_conflict",
				);
			} else {
				this.ownedUserIds.add(userId);
				this.inactiveOwnedUserDeadlines.delete(userId);
				if (status === 1) {
					logger.info(
						{ userId, instanceId: this.instanceId },
						"affinity_recovered",
					);
				}
			}
		}
		return conflicts;
	}
}
