import os from "node:os";
import path from "node:path";
import type { CliConfig } from "./config.js";
import { logger } from "./lib/logger.js";

const CURATED_EXAMPLE_AGENT_IDS = ["claude-acp", "codex-acp", "opencode"];

export type StartPreflightFailureCode =
	| "registry-unavailable"
	| "no-enabled-agents"
	| "configured-agents-invalid"
	| "configured-agents-unrunnable"
	| "no-runnable-agents";

export type StartPreflightFailure = {
	code: StartPreflightFailureCode;
	configPath: string;
	selectableIds: string[];
	hasRegistryData: boolean;
};

export class ReportedCliError extends Error {
	constructor(
		message: string,
		public readonly exitCode = 1,
	) {
		super(message);
		this.name = "ReportedCliError";
	}
}

const toTildePath = (inputPath: string): string => {
	const homeDir = os.homedir();
	if (inputPath === homeDir) {
		return "~";
	}
	if (inputPath.startsWith(`${homeDir}${path.sep}`)) {
		return `~${inputPath.slice(homeDir.length)}`;
	}
	return inputPath;
};

const getConfigPath = (config: CliConfig): string =>
	toTildePath(
		config.userConfigPath ?? path.join(config.homePath, ".config.json"),
	);

export const getStartPreflightFailure = (
	config: CliConfig,
): StartPreflightFailure | null => {
	if (config.acpBackends.length > 0) {
		return null;
	}

	const registryIds = config.registryAgents.map((agent) => agent.id);
	const registryIdSet = new Set(registryIds);
	const detectedIdSet = new Set(
		config.detectedBackends.map((backend) => backend.id),
	);
	const enabledAgents = config.enabledAgents ?? [];
	const knownEnabledAgents = enabledAgents.filter((id) =>
		registryIdSet.has(id),
	);
	const runnableEnabledAgents = enabledAgents.filter((id) =>
		detectedIdSet.has(id),
	);

	if (config.registrySource === "unavailable") {
		return {
			code: "registry-unavailable",
			configPath: getConfigPath(config),
			selectableIds: CURATED_EXAMPLE_AGENT_IDS,
			hasRegistryData: false,
		};
	}

	if (config.enabledAgents && config.enabledAgents.length === 0) {
		return {
			code: "no-enabled-agents",
			configPath: getConfigPath(config),
			selectableIds: registryIds,
			hasRegistryData: true,
		};
	}

	if (config.enabledAgents && knownEnabledAgents.length === 0) {
		return {
			code: "configured-agents-invalid",
			configPath: getConfigPath(config),
			selectableIds: registryIds,
			hasRegistryData: true,
		};
	}

	if (config.enabledAgents && runnableEnabledAgents.length === 0) {
		return {
			code: "configured-agents-unrunnable",
			configPath: getConfigPath(config),
			selectableIds: registryIds,
			hasRegistryData: true,
		};
	}

	return {
		code: "no-runnable-agents",
		configPath: getConfigPath(config),
		selectableIds: registryIds,
		hasRegistryData: true,
	};
};

const getReasonText = (failure: StartPreflightFailure): string => {
	switch (failure.code) {
		case "registry-unavailable":
			return "The ACP agent registry could not be fetched, and no cached registry is available.";
		case "no-enabled-agents":
			return "No agent IDs are currently enabled, so mobvibe has nothing to start.";
		case "configured-agents-invalid":
			return "The configured enabledAgents IDs do not match any agent IDs in the current registry.";
		case "configured-agents-unrunnable":
			return "The configured agent IDs exist in the registry, but none are runnable on this machine.";
		case "no-runnable-agents":
			return "Registry data is available, but no agents from that registry are runnable on this machine.";
	}
};

const getGuidanceText = (failure: StartPreflightFailure): string | null => {
	switch (failure.code) {
		case "configured-agents-unrunnable":
		case "no-runnable-agents":
			return "Install the required launcher or toolchain and confirm that `npx`, `uvx`, or the agent binary is available in `PATH`.";
		default:
			return null;
	}
};

export const formatStartPreflightFailure = (
	failure: StartPreflightFailure,
): string => {
	const selectableLabel = failure.hasRegistryData
		? "Selectable agent IDs from the current registry:"
		: "Example agent IDs only (registry unavailable; not the full authoritative list):";
	const guidance = getGuidanceText(failure);

	return [
		"",
		"========================================",
		"mobvibe start aborted: no usable ACP backends",
		"========================================",
		`Reason: ${getReasonText(failure)}`,
		"",
		`Edit ${failure.configPath} and set:`,
		"{",
		'  "enabledAgents": ["claude-acp", "codex-acp", "opencode"]',
		"}",
		"",
		selectableLabel,
		`  ${failure.selectableIds.join(", ")}`,
		...(guidance ? ["", guidance] : []),
		"",
		"Retry `mobvibe start` after editing the config and/or fixing registry connectivity or local agent tooling.",
	].join("\n");
};

export const ensureStartPreflight = (
	config: CliConfig,
	writeError: (message: string) => void = console.error,
): void => {
	const failure = getStartPreflightFailure(config);
	if (!failure) {
		return;
	}

	logger.error({ reason: failure.code }, "start_preflight_failed");
	writeError(formatStartPreflightFailure(failure));
	throw new ReportedCliError("No usable ACP backends available");
};
