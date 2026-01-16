import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Express;
let server: ReturnType<Express["listen"]>;
let baseUrl: string;
let homeDir: string;
let outsideDir: string;
let filePath: string;
let symlinkPath: string;
let originalHome: string | undefined;
let originalNodeEnv: string | undefined;

const closeServer = (activeServer: ReturnType<Express["listen"]>) =>
	new Promise<void>((resolve, reject) => {
		activeServer.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

const buildEntriesUrl = (pathValue: string) =>
	`${baseUrl}/fs/entries?path=${encodeURIComponent(pathValue)}`;

beforeAll(async () => {
	originalHome = process.env.HOME;
	originalNodeEnv = process.env.NODE_ENV;
	process.env.NODE_ENV = "test";
	process.env.HOME = await fs.mkdtemp(path.join(os.tmpdir(), "mobvibe-home-"));
	homeDir = process.env.HOME;

	const module = await import("../src/index.js");
	app = module.app;

	const documentsPath = path.join(homeDir, "Documents");
	await fs.mkdir(path.join(documentsPath, "Work"), { recursive: true });
	filePath = path.join(homeDir, "notes.txt");
	await fs.writeFile(filePath, "notes");

	outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobvibe-outside-"));
	symlinkPath = path.join(homeDir, "outside-link");
	await fs.symlink(outsideDir, symlinkPath);

	server = app.listen(0);
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("未能获取测试端口");
	}
	baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	await closeServer(server);
	await fs.rm(homeDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (originalNodeEnv === undefined) {
		delete process.env.NODE_ENV;
	} else {
		process.env.NODE_ENV = originalNodeEnv;
	}
});

describe("fs routes", () => {
	it("returns home root info", async () => {
		const response = await fetch(`${baseUrl}/fs/roots`);
		expect(response.ok).toBe(true);
		const payload = (await response.json()) as {
			homePath: string;
			roots: { name: string; path: string }[];
		};
		const resolvedHome = await fs.realpath(homeDir);
		expect(payload.homePath).toBe(resolvedHome);
		expect(payload.roots).toEqual([{ name: "Home", path: resolvedHome }]);
	});

	it("lists directory entries", async () => {
		const response = await fetch(buildEntriesUrl(homeDir));
		expect(response.ok).toBe(true);
		const payload = (await response.json()) as {
			path: string;
			entries: { name: string; type: string }[];
		};
		const names = payload.entries.map((entry) => entry.name);
		expect(payload.path).toBe(await fs.realpath(homeDir));
		expect(names).toContain("Documents");
		expect(names).toContain("notes.txt");
		const documentsEntry = payload.entries.find(
			(entry) => entry.name === "Documents",
		);
		expect(documentsEntry?.type).toBe("directory");
	});

	it("rejects non-directory paths", async () => {
		const response = await fetch(buildEntriesUrl(filePath));
		expect(response.status).toBe(400);
		const payload = (await response.json()) as { error: { message: string } };
		expect(payload.error.message).toBe("路径必须是目录");
	});

	it("rejects paths outside home", async () => {
		const response = await fetch(buildEntriesUrl(outsideDir));
		expect(response.status).toBe(403);
		const payload = (await response.json()) as { error: { message: string } };
		expect(payload.error.message).toBe("路径必须位于 Home 目录内");
	});

	it("rejects symlink paths outside home", async () => {
		const response = await fetch(buildEntriesUrl(symlinkPath));
		expect(response.status).toBe(403);
		const payload = (await response.json()) as { error: { message: string } };
		expect(payload.error.message).toBe("路径必须位于 Home 目录内");
	});

	it("reports missing paths", async () => {
		const missingPath = path.join(homeDir, "missing");
		const response = await fetch(buildEntriesUrl(missingPath));
		expect(response.status).toBe(404);
		const payload = (await response.json()) as { error: { message: string } };
		expect(payload.error.message).toBe("路径不存在");
	});
});
