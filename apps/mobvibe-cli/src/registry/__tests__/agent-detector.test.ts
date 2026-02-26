import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import os from "node:os";
import type { RegistryAgent, RegistryData } from "@mobvibe/shared";
import { detectAgents } from "../agent-detector.js";

// Save originals for platform mocking
const originalPlatform = os.platform;
const originalArch = os.arch;

// Save original Bun.which
const originalWhich = Bun.which;

beforeEach(() => {
	// Default: Linux x64
	os.platform = mock(() => "linux" as NodeJS.Platform);
	os.arch = mock(() => "x64") as typeof os.arch;
});

afterEach(() => {
	os.platform = originalPlatform;
	os.arch = originalArch;
	Bun.which = originalWhich;
});

const makeRegistry = (agents: RegistryAgent[]): RegistryData => ({
	version: "1.0.0",
	agents,
	extensions: [],
});

const npxAgent: RegistryAgent = {
	id: "test-npx",
	name: "Test NPX Agent",
	version: "1.0.0",
	description: "An npx agent",
	icon: "https://example.com/icon.svg",
	distribution: {
		npx: {
			package: "@test/agent@1.0.0",
			args: ["--acp"],
			env: { DISABLE_UPDATE: "1" },
		},
	},
};

const binaryAgent: RegistryAgent = {
	id: "test-binary",
	name: "Test Binary Agent",
	version: "2.0.0",
	description: "A binary agent",
	distribution: {
		binary: {
			"linux-x86_64": {
				archive: "https://example.com/archive.tar.gz",
				cmd: "test-binary-cmd",
				args: ["serve"],
			},
			"darwin-aarch64": {
				archive: "https://example.com/archive-mac.tar.gz",
				cmd: "test-binary-cmd",
				args: ["serve"],
			},
		},
	},
};

const uvxAgent: RegistryAgent = {
	id: "test-uvx",
	name: "Test UVX Agent",
	version: "0.1.0",
	description: "A uvx agent",
	distribution: {
		uvx: {
			package: "test-uvx-pkg@0.1.0",
			args: ["acp"],
		},
	},
};

const multiDistAgent: RegistryAgent = {
	id: "test-multi",
	name: "Test Multi Agent",
	version: "3.0.0",
	description: "Agent with binary + npx",
	distribution: {
		npx: { package: "@test/multi@3.0.0" },
		binary: {
			"linux-x86_64": {
				archive: "https://example.com/multi.tar.gz",
				cmd: "multi-bin",
			},
		},
	},
};

describe("detectAgents", () => {
	it("detects npx agents when npx is available", async () => {
		Bun.which = mock((cmd: string) =>
			cmd === "npx" ? "/usr/bin/npx" : null,
		) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([npxAgent]));

		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({
			id: "test-npx",
			label: "Test NPX Agent",
			icon: "https://example.com/icon.svg",
			description: "An npx agent",
			command: "npx",
			args: ["-y", "@test/agent@1.0.0", "--acp"],
			envOverrides: { DISABLE_UPDATE: "1" },
		});
	});

	it("skips npx agents when npx is not available", async () => {
		Bun.which = mock(() => null) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([npxAgent]));
		expect(results).toHaveLength(0);
	});

	it("detects binary agents when binary is in PATH", async () => {
		Bun.which = mock((cmd: string) =>
			cmd === "test-binary-cmd" ? "/usr/local/bin/test-binary-cmd" : null,
		) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([binaryAgent]));

		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({
			id: "test-binary",
			label: "Test Binary Agent",
			icon: undefined,
			description: "A binary agent",
			command: "test-binary-cmd",
			args: ["serve"],
			envOverrides: undefined,
		});
	});

	it("skips binary agents when binary is not in PATH", async () => {
		Bun.which = mock(() => null) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([binaryAgent]));
		expect(results).toHaveLength(0);
	});

	it("skips binary agents on non-matching platform", async () => {
		os.platform = mock(() => "freebsd" as NodeJS.Platform);
		Bun.which = mock(() => "/some/path") as typeof Bun.which;

		const results = await detectAgents(makeRegistry([binaryAgent]));
		expect(results).toHaveLength(0);
	});

	it("detects uvx agents when uvx is available", async () => {
		Bun.which = mock((cmd: string) =>
			cmd === "uvx" ? "/usr/bin/uvx" : null,
		) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([uvxAgent]));

		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({
			id: "test-uvx",
			label: "Test UVX Agent",
			icon: undefined,
			description: "A uvx agent",
			command: "uvx",
			args: ["test-uvx-pkg@0.1.0", "acp"],
			envOverrides: undefined,
		});
	});

	it("prefers binary over npx for multi-distribution agents", async () => {
		Bun.which = mock((cmd: string) => {
			if (cmd === "npx") return "/usr/bin/npx";
			if (cmd === "multi-bin") return "/usr/local/bin/multi-bin";
			return null;
		}) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([multiDistAgent]));

		expect(results).toHaveLength(1);
		expect(results[0].command).toBe("multi-bin");
	});

	it("falls back to npx when binary not in PATH for multi-dist agents", async () => {
		Bun.which = mock((cmd: string) =>
			cmd === "npx" ? "/usr/bin/npx" : null,
		) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([multiDistAgent]));

		expect(results).toHaveLength(1);
		expect(results[0].command).toBe("npx");
		expect(results[0].args).toEqual(["-y", "@test/multi@3.0.0"]);
	});

	it("returns empty array for empty registry", async () => {
		const results = await detectAgents(makeRegistry([]));
		expect(results).toHaveLength(0);
	});

	it("passes through env overrides from distribution", async () => {
		Bun.which = mock((cmd: string) =>
			cmd === "npx" ? "/usr/bin/npx" : null,
		) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([npxAgent]));

		expect(results[0].envOverrides).toEqual({ DISABLE_UPDATE: "1" });
	});

	it("omits envOverrides when distribution has no env", async () => {
		Bun.which = mock((cmd: string) =>
			cmd === "uvx" ? "/usr/bin/uvx" : null,
		) as typeof Bun.which;

		const results = await detectAgents(makeRegistry([uvxAgent]));
		expect(results[0].envOverrides).toBeUndefined();
	});
});
