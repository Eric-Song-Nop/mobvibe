import {
	cancel,
	intro,
	isCancel,
	log,
	multiselect,
	outro,
} from "@clack/prompts";
import { type CliConfig, getCliConfig } from "./config.js";
import { saveUserConfig } from "./config-loader.js";
import { DaemonManager } from "./daemon/daemon.js";
import {
	type ResolveResult,
	resolveSelectedAgents,
} from "./registry/agent-detector.js";
import { ensureStartPreflight } from "./startup-preflight.js";

export type StartCommandOptions = {
	gateway?: string;
	foreground?: boolean;
	noE2ee?: boolean;
};

type PromptApi = {
	intro(message: string): void;
	multiselect(options: {
		message: string;
		options: { value: string; label: string; hint: string }[];
		required: boolean;
	}): Promise<unknown>;
	isCancel(value: unknown): boolean;
	cancel(message: string): void;
	warn(message: string): void;
	outro(message: string): void;
};

type StartCommandDeps = {
	getCliConfig: () => Promise<CliConfig>;
	saveUserConfig: (
		homePath: string,
		patch: { enabledAgents: string[] },
	) => Promise<void>;
	createDaemonManager: (config: CliConfig) => Pick<DaemonManager, "start">;
	resolveSelectedAgents: (
		agents: CliConfig["registryAgents"],
		selectedIds: string[],
	) => ResolveResult;
	prompt: PromptApi;
	stdoutIsTTY: boolean;
	writeError: (message: string) => void;
};

const defaultPrompt: PromptApi = {
	intro,
	multiselect,
	isCancel,
	cancel,
	warn: (message) => log.warn(message),
	outro,
};

const getDefaultDeps = (): StartCommandDeps => ({
	getCliConfig,
	saveUserConfig,
	createDaemonManager: (config) => new DaemonManager(config),
	resolveSelectedAgents,
	prompt: defaultPrompt,
	stdoutIsTTY: process.stdout.isTTY,
	writeError: console.error,
});

export const runStartCommand = async (
	options: StartCommandOptions,
	overrides: Partial<StartCommandDeps> = {},
): Promise<void> => {
	if (options.gateway) {
		process.env.MOBVIBE_GATEWAY_URL = options.gateway;
	}

	const deps = {
		...getDefaultDeps(),
		...overrides,
	};
	const config = await deps.getCliConfig();

	if (config.enabledAgents === undefined && deps.stdoutIsTTY) {
		if (config.registryAgents.length > 0) {
			deps.prompt.intro("Welcome to Mobvibe!");
			const selected = await deps.prompt.multiselect({
				message: "Which agents do you want to enable?",
				options: config.registryAgents.map((agent) => ({
					value: agent.id,
					label: agent.name,
					hint: agent.description,
				})),
				required: false,
			});

			if (deps.prompt.isCancel(selected)) {
				deps.prompt.cancel("Setup cancelled.");
				return;
			}

			const enabledIds = selected as string[];
			const { resolved, failed } = deps.resolveSelectedAgents(
				config.registryAgents,
				enabledIds,
			);

			if (failed.length > 0) {
				for (const agent of failed) {
					deps.prompt.warn(
						`Agent "${agent.name}" cannot be resolved — binary not in PATH, or npx/uvx unavailable. Skipping for this run.`,
					);
				}
			}

			await deps.saveUserConfig(config.homePath, {
				enabledAgents: enabledIds,
			});
			config.enabledAgents = enabledIds;
			config.acpBackends = resolved;
			if (resolved.length > 0) {
				deps.prompt.outro(
					`Enabled ${resolved.length} agent(s). Config saved to ${config.homePath}/.config.json`,
				);
			}
		}
	}

	ensureStartPreflight(config, deps.writeError);

	const daemon = deps.createDaemonManager(config);
	await daemon.start({
		foreground: options.foreground,
		noE2ee: options.noE2ee,
	});
};
