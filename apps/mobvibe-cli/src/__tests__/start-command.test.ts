import { describe, expect, it, mock } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { RegistryAgent } from "@mobvibe/shared";
import type { CliConfig } from "../config.js";
import { runStartCommand } from "../start-command.js";
import { ReportedCliError } from "../startup-preflight.js";

const makeRegistryAgent = (id: string): RegistryAgent => ({
	id,
	name: id,
	version: "1.0.0",
	description: `${id} agent`,
	distribution: {
		npx: {
			package: `${id}@1.0.0`,
		},
	},
});

const makeConfig = (overrides: Partial<CliConfig> = {}): CliConfig => ({
	gatewayUrl: "https://api.mobvibe.test",
	acpBackends: [],
	detectedBackends: [],
	clientName: "mobvibe-cli",
	clientVersion: "0.0.0-test",
	homePath: path.join(os.homedir(), ".mobvibe"),
	logPath: path.join(os.homedir(), ".mobvibe", "logs"),
	pidFile: path.join(os.homedir(), ".mobvibe", "daemon.pid"),
	walDbPath: path.join(os.homedir(), ".mobvibe", "events.db"),
	machineId: "test-machine",
	hostname: "test-host",
	platform: "darwin",
	userConfigPath: path.join(os.homedir(), ".mobvibe", ".config.json"),
	compaction: {
		enabled: false,
		ackedEventRetentionDays: 7,
		keepLatestRevisionsCount: 2,
		runOnStartup: false,
		runIntervalHours: 24,
		minEventsToKeep: 1000,
	},
	consolidation: {
		enabled: true,
	},
	worktreeBaseDir: path.join(os.homedir(), ".mobvibe", "worktrees"),
	registryAgents: [],
	registrySource: "unavailable",
	enabledAgents: undefined,
	...overrides,
});

describe("runStartCommand", () => {
	it("aborts before daemon startup when registry fetch fails and no cache exists", async () => {
		const config = makeConfig();
		const start = mock(async () => undefined);
		const errors: string[] = [];

		await expect(
			runStartCommand(
				{},
				{
					getCliConfig: async () => config,
					createDaemonManager: () => ({ start }),
					stdoutIsTTY: false,
					writeError: (message) => errors.push(message),
				},
			),
		).rejects.toBeInstanceOf(ReportedCliError);

		expect(start).not.toHaveBeenCalled();
		expect(errors[0]).toContain("~/.mobvibe/.config.json");
		expect(errors[0]).toContain(
			'"enabledAgents": ["claude-acp", "codex-acp", "opencode"]',
		);
		expect(errors[0]).toContain("claude-acp, codex-acp, opencode");
		expect(errors[0]).toContain("Example agent IDs only");
	});

	it("prints exact selectable IDs when registry data exists but no agents resolve", async () => {
		const config = makeConfig({
			registrySource: "stale-cache",
			registryAgents: [
				makeRegistryAgent("claude-acp"),
				makeRegistryAgent("opencode"),
			],
		});
		const start = mock(async () => undefined);
		const errors: string[] = [];

		await expect(
			runStartCommand(
				{},
				{
					getCliConfig: async () => config,
					createDaemonManager: () => ({ start }),
					stdoutIsTTY: false,
					writeError: (message) => errors.push(message),
				},
			),
		).rejects.toBeInstanceOf(ReportedCliError);

		expect(start).not.toHaveBeenCalled();
		expect(errors[0]).toContain(
			"Selectable agent IDs from the current registry",
		);
		expect(errors[0]).toContain("claude-acp, opencode");
	});

	it("aborts when enabledAgents contains only unknown IDs", async () => {
		const config = makeConfig({
			registrySource: "network",
			registryAgents: [makeRegistryAgent("claude-acp")],
			detectedBackends: [
				{
					id: "claude-acp",
					label: "Claude ACP",
					command: "/usr/bin/npx",
					args: ["-y", "claude-acp"],
				},
			],
			enabledAgents: ["unknown-agent"],
		});
		const errors: string[] = [];

		await expect(
			runStartCommand(
				{},
				{
					getCliConfig: async () => config,
					createDaemonManager: () => ({ start: async () => undefined }),
					stdoutIsTTY: false,
					writeError: (message) => errors.push(message),
				},
			),
		).rejects.toBeInstanceOf(ReportedCliError);

		expect(errors[0]).toContain(
			"enabledAgents IDs do not match any agent IDs in the current registry",
		);
	});

	it("aborts with launcher guidance when enabledAgents are valid but not runnable", async () => {
		const config = makeConfig({
			registrySource: "network",
			registryAgents: [makeRegistryAgent("claude-acp")],
			enabledAgents: ["claude-acp"],
		});
		const errors: string[] = [];

		await expect(
			runStartCommand(
				{},
				{
					getCliConfig: async () => config,
					createDaemonManager: () => ({ start: async () => undefined }),
					stdoutIsTTY: false,
					writeError: (message) => errors.push(message),
				},
			),
		).rejects.toBeInstanceOf(ReportedCliError);

		expect(errors[0]).toContain("none are runnable on this machine");
		expect(errors[0]).toContain("`npx`, `uvx`, or the agent binary");
		expect(errors[0]).toContain("`PATH`");
	});

	it("continues startup when at least one backend resolves", async () => {
		const start = mock(async () => undefined);
		const config = makeConfig({
			registrySource: "network",
			registryAgents: [makeRegistryAgent("claude-acp")],
			detectedBackends: [
				{
					id: "claude-acp",
					label: "Claude ACP",
					command: "/usr/bin/npx",
					args: ["-y", "claude-acp"],
				},
			],
			acpBackends: [
				{
					id: "claude-acp",
					label: "Claude ACP",
					command: "/usr/bin/npx",
					args: ["-y", "claude-acp"],
				},
			],
		});

		await runStartCommand(
			{ foreground: true, noE2ee: true },
			{
				getCliConfig: async () => config,
				createDaemonManager: () => ({ start }),
				stdoutIsTTY: false,
			},
		);

		expect(start).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledWith({
			foreground: true,
			noE2ee: true,
		});
	});

	it("fails after first-run selection if selected agents still resolve to zero backends", async () => {
		const config = makeConfig({
			registrySource: "network",
			registryAgents: [makeRegistryAgent("claude-acp")],
		});
		const start = mock(async () => undefined);
		const savedConfigs: string[][] = [];
		const errors: string[] = [];

		await expect(
			runStartCommand(
				{},
				{
					getCliConfig: async () => config,
					createDaemonManager: () => ({ start }),
					resolveSelectedAgents: () => ({
						resolved: [],
						failed: [makeRegistryAgent("claude-acp")],
					}),
					saveUserConfig: async (_homePath, patch) => {
						savedConfigs.push(patch.enabledAgents);
					},
					stdoutIsTTY: true,
					writeError: (message) => errors.push(message),
					prompt: {
						intro: () => undefined,
						multiselect: async () => ["claude-acp"],
						isCancel: () => false,
						cancel: () => undefined,
						warn: () => undefined,
						outro: () => undefined,
					},
				},
			),
		).rejects.toBeInstanceOf(ReportedCliError);

		expect(start).not.toHaveBeenCalled();
		expect(savedConfigs).toEqual([["claude-acp"]]);
		expect(errors[0]).toContain("none are runnable on this machine");
		expect(errors[0]).toContain("claude-acp");
	});
});
