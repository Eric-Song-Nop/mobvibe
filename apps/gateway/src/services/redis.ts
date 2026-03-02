import { Redis } from "ioredis";
import { logger } from "../lib/logger.js";

let redis: Redis | null = null;

export type { Redis };

/**
 * Initialize Redis connection from REDIS_URL.
 * Returns null if REDIS_URL is not set or connection fails (graceful degradation).
 */
export async function initRedis(
	redisUrl: string | undefined,
): Promise<Redis | null> {
	if (!redisUrl) {
		logger.info("redis_disabled_no_url");
		return null;
	}

	try {
		const client = new Redis(redisUrl, {
			maxRetriesPerRequest: 3,
			retryStrategy(times) {
				if (times > 5) {
					logger.warn({ times }, "redis_retry_exhausted");
					return null;
				}
				return Math.min(times * 200, 2000);
			},
			lazyConnect: true,
		});

		client.on("error", (err) => {
			logger.warn({ err }, "redis_connection_error");
		});

		await client.connect();
		logger.info("redis_connected");
		redis = client;
		return client;
	} catch (err) {
		logger.warn({ err }, "redis_init_failed_degrading");
		return null;
	}
}

/** Get the current Redis instance, or null if unavailable. */
export function getRedis(): Redis | null {
	return redis;
}

/** Close the Redis connection. */
export async function closeRedis(): Promise<void> {
	if (redis) {
		await redis.quit();
		redis = null;
		logger.info("redis_closed");
	}
}
