import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RegistryData } from "@mobvibe/shared";

// Restore real node:fs/promises — session-manager.test.ts mocks it globally
// via Bun's mock.module which leaks across test files.
// We derive the real implementation from node:fs (which is NOT mocked).
mock.module("node:fs/promises", () => ({
	default: fs.promises,
	...fs.promises,
}));

// Dynamic import so registry-client.ts picks up the restored fs module
const { getRegistry } = await import("../registry-client.js");

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

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "registry-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Helper: write a cache file into tmpDir/cache/registry.json */
const writeCacheFile = (data: string, backdate?: number) => {
	const cacheDir = path.join(tmpDir, "cache");
	fs.mkdirSync(cacheDir, { recursive: true });
	const cachePath = path.join(cacheDir, "registry.json");
	fs.writeFileSync(cachePath, data, "utf-8");
	if (backdate) {
		const pastTime = new Date(Date.now() - backdate);
		fs.utimesSync(cachePath, pastTime, pastTime);
	}
};

describe("getRegistry", () => {
	it("returns cached data when cache is fresh", async () => {
		writeCacheFile(JSON.stringify(SAMPLE_REGISTRY));

		const result = await getRegistry({
			homePath: tmpDir,
			cacheTtlMs: 60_000,
		});

		expect(result).toEqual(SAMPLE_REGISTRY);
	});

	it("ignores expired cache and fetches from network", async () => {
		writeCacheFile(JSON.stringify(SAMPLE_REGISTRY), 7_200_000);

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
		writeCacheFile(JSON.stringify(SAMPLE_REGISTRY), 7_200_000);

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
		writeCacheFile("not-valid-json{{{");

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
