import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RegistryData } from "@mobvibe/shared";
import { getRegistry } from "../registry-client.js";

const SAMPLE_REGISTRY: RegistryData = {
	version: "1.0.0",
	agents: [
		{
			id: "test-agent",
			name: "Test Agent",
			version: "1.0.0",
			description: "A test agent",
			distribution: {
				npx: { package: "test-agent@1.0.0" },
			},
		},
	],
	extensions: [],
};

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "registry-test-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getRegistry", () => {
	it("returns cached data when cache is fresh", async () => {
		// Write a fresh cache file
		const cacheDir = path.join(tmpDir, "cache");
		await fs.mkdir(cacheDir, { recursive: true });
		await fs.writeFile(
			path.join(cacheDir, "registry.json"),
			JSON.stringify(SAMPLE_REGISTRY),
		);

		const result = await getRegistry({
			homePath: tmpDir,
			cacheTtlMs: 60_000,
		});

		expect(result).toEqual(SAMPLE_REGISTRY);
	});

	it("ignores expired cache and fetches from network", async () => {
		// Write a cache file and backdate it
		const cacheDir = path.join(tmpDir, "cache");
		await fs.mkdir(cacheDir, { recursive: true });
		const cachePath = path.join(cacheDir, "registry.json");
		await fs.writeFile(cachePath, JSON.stringify(SAMPLE_REGISTRY));

		// Backdate mtime to be expired
		const pastTime = new Date(Date.now() - 7_200_000);
		await fs.utimes(cachePath, pastTime, pastTime);

		// Mock fetch to return updated data
		const updatedRegistry: RegistryData = {
			...SAMPLE_REGISTRY,
			version: "2.0.0",
		};
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify(updatedRegistry), { status: 200 }),
			),
		) as unknown as typeof fetch;

		try {
			const result = await getRegistry({
				homePath: tmpDir,
				cacheTtlMs: 3_600_000,
			});

			expect(result).toEqual(updatedRegistry);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("falls back to stale cache when network fails", async () => {
		// Write a stale cache
		const cacheDir = path.join(tmpDir, "cache");
		await fs.mkdir(cacheDir, { recursive: true });
		const cachePath = path.join(cacheDir, "registry.json");
		await fs.writeFile(cachePath, JSON.stringify(SAMPLE_REGISTRY));

		// Backdate mtime
		const pastTime = new Date(Date.now() - 7_200_000);
		await fs.utimes(cachePath, pastTime, pastTime);

		// Mock fetch to fail
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.reject(new Error("Network error")),
		) as unknown as typeof fetch;

		try {
			const result = await getRegistry({
				homePath: tmpDir,
				cacheTtlMs: 3_600_000,
			});

			expect(result).toEqual(SAMPLE_REGISTRY);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns null when no cache and network fails", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.reject(new Error("Network error")),
		) as unknown as typeof fetch;

		try {
			const result = await getRegistry({
				homePath: tmpDir,
				cacheTtlMs: 3_600_000,
			});

			expect(result).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns null when cache contains invalid JSON and network fails", async () => {
		const cacheDir = path.join(tmpDir, "cache");
		await fs.mkdir(cacheDir, { recursive: true });
		await fs.writeFile(
			path.join(cacheDir, "registry.json"),
			"not-valid-json{{{",
		);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.reject(new Error("Network error")),
		) as unknown as typeof fetch;

		try {
			const result = await getRegistry({
				homePath: tmpDir,
				cacheTtlMs: 3_600_000,
			});

			expect(result).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("uses custom URL when provided", async () => {
		const customUrl = "https://custom.example.com/registry.json";
		let fetchedUrl = "";

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock((input: string | URL | Request) => {
			fetchedUrl = typeof input === "string" ? input : input.toString();
			return Promise.resolve(
				new Response(JSON.stringify(SAMPLE_REGISTRY), { status: 200 }),
			);
		}) as unknown as typeof fetch;

		try {
			await getRegistry({
				homePath: tmpDir,
				url: customUrl,
				cacheTtlMs: 3_600_000,
			});

			expect(fetchedUrl).toBe(customUrl);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
