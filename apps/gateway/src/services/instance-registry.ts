import type { Redis } from "./redis.js";
import { logger } from "../lib/logger.js";

const INSTANCE_KEY_PREFIX = "gw:inst:";
const INSTANCE_TTL_SECONDS = 30;
const HEARTBEAT_INTERVAL_MS = 10_000;

export class InstanceRegistry {
	private heartbeatTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly redis: Redis,
		private readonly instanceId: string,
		private readonly region: string | undefined,
	) {}

	/** Register this instance in Redis with TTL. */
	async register(): Promise<void> {
		const key = `${INSTANCE_KEY_PREFIX}${this.instanceId}`;
		const value = JSON.stringify({
			region: this.region,
			users: 0,
			registeredAt: Date.now(),
		});
		await this.redis.set(key, value, "EX", INSTANCE_TTL_SECONDS);
		logger.info(
			{ instanceId: this.instanceId, region: this.region },
			"instance_registered",
		);
	}

	/** Update heartbeat TTL and user count. */
	async heartbeat(userCount: number): Promise<void> {
		const key = `${INSTANCE_KEY_PREFIX}${this.instanceId}`;
		const value = JSON.stringify({
			region: this.region,
			users: userCount,
			registeredAt: Date.now(),
		});
		await this.redis.set(key, value, "EX", INSTANCE_TTL_SECONDS);
	}

	/** Remove this instance from Redis. */
	async deregister(): Promise<void> {
		const key = `${INSTANCE_KEY_PREFIX}${this.instanceId}`;
		await this.redis.del(key);
		logger.info({ instanceId: this.instanceId }, "instance_deregistered");
	}

	/** Start periodic heartbeat. */
	startHeartbeatLoop(getUserCount: () => number): void {
		this.stopHeartbeatLoop();
		this.heartbeatTimer = setInterval(() => {
			this.heartbeat(getUserCount()).catch((err) => {
				logger.warn({ err }, "instance_heartbeat_failed");
			});
		}, HEARTBEAT_INTERVAL_MS);
	}

	/** Stop periodic heartbeat. */
	stopHeartbeatLoop(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
}
