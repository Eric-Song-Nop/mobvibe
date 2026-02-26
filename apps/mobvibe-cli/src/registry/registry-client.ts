import fs from "node:fs/promises";
import path from "node:path";
import type { RegistryData } from "@mobvibe/shared";
import { logger } from "../lib/logger.js";

const DEFAULT_REGISTRY_URL =
	"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1 hour
const FETCH_TIMEOUT_MS = 5_000;

export type RegistryClientOptions = {
	/** Base path for ~/.mobvibe */
	homePath: string;
	/** Custom registry URL */
	url?: string;
	/** Cache TTL in milliseconds */
	cacheTtlMs?: number;
};

const getCachePath = (homePath: string): string =>
	path.join(homePath, "cache", "registry.json");

/** Read cached registry if fresh enough, otherwise return null */
const readCache = async (
	cachePath: string,
	ttlMs: number,
): Promise<RegistryData | null> => {
	try {
		const stat = await fs.stat(cachePath);
		const age = Date.now() - stat.mtimeMs;
		if (age > ttlMs) return null;

		const content = await fs.readFile(cachePath, "utf-8");
		return JSON.parse(content) as RegistryData;
	} catch {
		return null;
	}
};

/** Read expired cache as fallback when network fails */
const readStaleCache = async (
	cachePath: string,
): Promise<RegistryData | null> => {
	try {
		const content = await fs.readFile(cachePath, "utf-8");
		return JSON.parse(content) as RegistryData;
	} catch {
		return null;
	}
};

/** Fetch registry from CDN and write to cache */
const fetchAndCache = async (
	url: string,
	cachePath: string,
): Promise<RegistryData> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as RegistryData;

		// Write cache (best-effort, don't block on failure)
		await fs.mkdir(path.dirname(cachePath), { recursive: true });
		await fs.writeFile(cachePath, JSON.stringify(data), "utf-8");

		return data;
	} finally {
		clearTimeout(timeout);
	}
};

/**
 * Fetch the ACP agent registry with local file caching.
 *
 * Strategy:
 * 1. If fresh cache exists (< TTL), use it
 * 2. Otherwise fetch from CDN (5s timeout)
 * 3. On network failure, fall back to stale cache
 * 4. If no cache at all, return null
 */
export const getRegistry = async (
	opts: RegistryClientOptions,
): Promise<RegistryData | null> => {
	const url = opts.url ?? DEFAULT_REGISTRY_URL;
	const ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const cachePath = getCachePath(opts.homePath);

	// 1. Try fresh cache
	const cached = await readCache(cachePath, ttlMs);
	if (cached) {
		logger.debug("registry_cache_hit");
		return cached;
	}

	// 2. Fetch from network
	try {
		const data = await fetchAndCache(url, cachePath);
		logger.info({ agentCount: data.agents.length }, "registry_fetched");
		return data;
	} catch (error) {
		logger.warn(
			{ error: error instanceof Error ? error.message : String(error) },
			"registry_fetch_failed",
		);
	}

	// 3. Fall back to stale cache
	const stale = await readStaleCache(cachePath);
	if (stale) {
		logger.info("registry_stale_cache_fallback");
		return stale;
	}

	// 4. No data available
	logger.warn("registry_unavailable");
	return null;
};
