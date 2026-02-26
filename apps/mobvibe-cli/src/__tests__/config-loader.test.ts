import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadUserConfig, saveUserConfig } from "../config-loader.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobvibe-cfg-test-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadUserConfig — enabledAgents validation", () => {
	it("accepts valid enabledAgents string array", async () => {
		const configPath = path.join(tmpDir, ".config.json");
		await fs.writeFile(
			configPath,
			JSON.stringify({ enabledAgents: ["claude-code", "aider"] }),
		);

		const result = await loadUserConfig(tmpDir);
		expect(result.errors).toHaveLength(0);
		expect(result.config?.enabledAgents).toEqual(["claude-code", "aider"]);
	});

	it("accepts empty enabledAgents array", async () => {
		const configPath = path.join(tmpDir, ".config.json");
		await fs.writeFile(configPath, JSON.stringify({ enabledAgents: [] }));

		const result = await loadUserConfig(tmpDir);
		expect(result.errors).toHaveLength(0);
		expect(result.config?.enabledAgents).toEqual([]);
	});

	it("rejects enabledAgents that is not an array", async () => {
		const configPath = path.join(tmpDir, ".config.json");
		await fs.writeFile(
			configPath,
			JSON.stringify({ enabledAgents: "claude-code" }),
		);

		const result = await loadUserConfig(tmpDir);
		expect(result.errors).toContain(
			"enabledAgents: must be an array of strings",
		);
		expect(result.config).toBeNull();
	});

	it("rejects enabledAgents with non-string elements", async () => {
		const configPath = path.join(tmpDir, ".config.json");
		await fs.writeFile(
			configPath,
			JSON.stringify({ enabledAgents: ["claude-code", 42] }),
		);

		const result = await loadUserConfig(tmpDir);
		expect(result.errors).toContain(
			"enabledAgents: every element must be a string",
		);
		expect(result.config).toBeNull();
	});

	it("returns undefined enabledAgents when field is absent", async () => {
		const configPath = path.join(tmpDir, ".config.json");
		await fs.writeFile(configPath, JSON.stringify({ worktreeBaseDir: "/tmp" }));

		const result = await loadUserConfig(tmpDir);
		expect(result.errors).toHaveLength(0);
		expect(result.config?.enabledAgents).toBeUndefined();
	});

	it("returns null config when no file exists", async () => {
		const result = await loadUserConfig(tmpDir);
		expect(result.errors).toHaveLength(0);
		expect(result.config).toBeNull();
	});
});

describe("saveUserConfig", () => {
	it("creates config file with patch when none exists", async () => {
		await saveUserConfig(tmpDir, { enabledAgents: ["claude-code"] });

		const configPath = path.join(tmpDir, ".config.json");
		const content = JSON.parse(await fs.readFile(configPath, "utf-8"));
		expect(content.enabledAgents).toEqual(["claude-code"]);
	});

	it("merges patch into existing config preserving other fields", async () => {
		const configPath = path.join(tmpDir, ".config.json");
		await fs.writeFile(
			configPath,
			JSON.stringify({ worktreeBaseDir: "/custom/path" }),
		);

		await saveUserConfig(tmpDir, { enabledAgents: ["aider"] });

		const content = JSON.parse(await fs.readFile(configPath, "utf-8"));
		expect(content.worktreeBaseDir).toBe("/custom/path");
		expect(content.enabledAgents).toEqual(["aider"]);
	});

	it("overwrites existing enabledAgents on re-save", async () => {
		await saveUserConfig(tmpDir, { enabledAgents: ["a", "b"] });
		await saveUserConfig(tmpDir, { enabledAgents: ["c"] });

		const configPath = path.join(tmpDir, ".config.json");
		const content = JSON.parse(await fs.readFile(configPath, "utf-8"));
		expect(content.enabledAgents).toEqual(["c"]);
	});

	it("creates parent directory if it does not exist", async () => {
		const nestedDir = path.join(tmpDir, "nested", "dir");

		await saveUserConfig(nestedDir, { enabledAgents: [] });

		const configPath = path.join(nestedDir, ".config.json");
		const content = JSON.parse(await fs.readFile(configPath, "utf-8"));
		expect(content.enabledAgents).toEqual([]);
	});

	it("handles corrupted existing config by starting fresh", async () => {
		const configPath = path.join(tmpDir, ".config.json");
		await fs.writeFile(configPath, "not valid json{{{");

		await saveUserConfig(tmpDir, { enabledAgents: ["x"] });

		const content = JSON.parse(await fs.readFile(configPath, "utf-8"));
		expect(content.enabledAgents).toEqual(["x"]);
	});
});
