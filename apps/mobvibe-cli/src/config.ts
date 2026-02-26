import os from "node:os";
import path from "node:path";
import type { AcpBackendId, UserAgentConfig } from "@mobvibe/shared";
import { getGatewayUrl } from "./auth/credentials.js";
import { loadUserConfig } from "./config-loader.js";
import { logger } from "./lib/logger.js";
import { detectAgents } from "./registry/agent-detector.js";
import { getRegistry } from "./registry/registry-client.js";

export type AcpBackendConfig = {
	id: AcpBackendId;
	label: string;
	command: string;
	args: string[];
	envOverrides?: Record<string, string>;
	icon?: string;
	description?: string;
};

export type CompactionConfig = {
	/** Enable automatic compaction */
	enabled: boolean;
	/** Keep acked events for this many days (default: 7) */
	ackedEventRetentionDays: number;
	/** Always keep this many latest revisions (default: 2) */
	keepLatestRevisionsCount: number;
	/** Run compaction on daemon startup (default: false) */
	runOnStartup: boolean;
	/** Run compaction every N hours (default: 24) */
	runIntervalHours: number;
	/** Safety: minimum events to keep per session (default: 1000) */
	minEventsToKeep: number;
	// P1-3: Removed unused config items:
	// - consolidateChunksAfterSec: chunk consolidation not implemented
	// - keepOldRevisionsDays: only keepLatestRevisionsCount is used
};

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
	enabled: false, // P0-8: Disabled by default - compaction deletes acked events which are the only history source
	ackedEventRetentionDays: 7,
	keepLatestRevisionsCount: 2,
	runOnStartup: false, // P0-8: Disabled - only run via explicit `mobvibe compact` command
	runIntervalHours: 24,
	minEventsToKeep: 1000,
};

export type CliConfig = {
	gatewayUrl: string;
	acpBackends: AcpBackendConfig[];
	clientName: string;
	clientVersion: string;
	homePath: string;
	logPath: string;
	pidFile: string;
	walDbPath: string;
	machineId: string;
	hostname: string;
	platform: string;
	userConfigPath?: string;
	userConfigErrors?: string[];
	compaction: CompactionConfig;
	/** Base directory for git worktrees (default: ~/.mobvibe/worktrees) */
	worktreeBaseDir: string;
};

const generateMachineId = (): string => {
	const hostname = os.hostname();
	const platform = os.platform();
	const arch = os.arch();
	const username = os.userInfo().username;
	return `${hostname}-${platform}-${arch}-${username}`;
};

const userAgentToBackendConfig = (
	agent: UserAgentConfig,
): AcpBackendConfig => ({
	id: agent.id,
	label: agent.label ?? agent.id,
	command: agent.command,
	args: agent.args ?? [],
	envOverrides: agent.env,
});

/**
 * Merge registry-detected backends with user-configured agents.
 *
 * 1. Registry agents form the base list
 * 2. User agents with a matching ID override the registry entry
 * 3. User agents with a new ID are appended (custom/private agents)
 */
export const mergeBackends = (
	registryBackends: AcpBackendConfig[],
	userAgents: UserAgentConfig[] | undefined,
): AcpBackendConfig[] => {
	if (!userAgents || userAgents.length === 0) {
		return registryBackends;
	}

	const userMap = new Map(
		userAgents.map((a) => [a.id, userAgentToBackendConfig(a)]),
	);

	// Replace registry entries that the user overrides
	const merged = registryBackends.map((rb) => userMap.get(rb.id) ?? rb);

	// Append user-only agents not found in registry
	const registryIds = new Set(registryBackends.map((b) => b.id));
	for (const [id, backend] of userMap) {
		if (!registryIds.has(id)) {
			merged.push(backend);
		}
	}

	return merged;
};

export const getCliConfig = async (): Promise<CliConfig> => {
	const env = process.env;
	const homePath = env.MOBVIBE_HOME ?? path.join(os.homedir(), ".mobvibe");

	// Load user configuration
	const userConfigResult = await loadUserConfig(homePath);

	// Log any config errors as warnings
	if (userConfigResult.errors.length > 0) {
		for (const error of userConfigResult.errors) {
			logger.warn({ configPath: userConfigResult.path, error }, "config_error");
		}
	}

	const registryConfig = userConfigResult.config?.registry;

	// Detect backends from registry (unless disabled)
	let registryBackends: AcpBackendConfig[] = [];
	if (!registryConfig?.disabled) {
		const registry = await getRegistry({
			homePath,
			url: registryConfig?.url,
			cacheTtlMs: registryConfig?.cacheTtlMs,
		});

		if (registry) {
			registryBackends = await detectAgents(registry);
		}
	}

	// Merge registry + user backends
	const backends = mergeBackends(
		registryBackends,
		userConfigResult.config?.agents,
	);

	// Get gateway URL (env var > credentials file > default production URL)
	const gatewayUrl = await getGatewayUrl();

	return {
		gatewayUrl,
		acpBackends: backends,
		clientName: env.MOBVIBE_ACP_CLIENT_NAME ?? "mobvibe-cli",
		clientVersion: env.MOBVIBE_ACP_CLIENT_VERSION ?? "0.0.0",
		homePath,
		logPath: path.join(homePath, "logs"),
		pidFile: path.join(homePath, "daemon.pid"),
		walDbPath: path.join(homePath, "events.db"),
		machineId: env.MOBVIBE_MACHINE_ID ?? generateMachineId(),
		hostname: os.hostname(),
		platform: os.platform(),
		userConfigPath: userConfigResult.path,
		userConfigErrors:
			userConfigResult.errors.length > 0 ? userConfigResult.errors : undefined,
		compaction: {
			...DEFAULT_COMPACTION_CONFIG,
			// Allow enabling via env var
			enabled: env.MOBVIBE_COMPACTION_ENABLED === "true",
		},
		worktreeBaseDir:
			env.MOBVIBE_WORKTREE_BASE_DIR ??
			userConfigResult.config?.worktreeBaseDir ??
			path.join(homePath, "worktrees"),
	};
};
