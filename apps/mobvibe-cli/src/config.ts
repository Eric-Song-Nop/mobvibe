import os from "node:os";
import path from "node:path";
import type { AcpBackendId, UserAgentConfig } from "@mobvibe/shared";
import { getGatewayUrl } from "./auth/credentials.js";
import { loadUserConfig } from "./config-loader.js";
import { logger } from "./lib/logger.js";

export type AcpBackendConfig = {
	id: AcpBackendId;
	label: string;
	command: string;
	args: string[];
	envOverrides?: Record<string, string>;
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
	defaultAcpBackendId: AcpBackendId;
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
};

// Default opencode backend
const DEFAULT_OPENCODE_BACKEND: AcpBackendConfig = {
	id: "opencode",
	label: "opencode",
	command: "opencode",
	args: ["acp"],
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

const mergeBackends = (
	defaultBackend: AcpBackendConfig,
	userAgents: UserAgentConfig[] | undefined,
): { backends: AcpBackendConfig[]; defaultId: AcpBackendId } => {
	// No user agents: use default opencode only
	if (!userAgents || userAgents.length === 0) {
		return { backends: [defaultBackend], defaultId: defaultBackend.id };
	}

	// Check if user defined opencode (override case)
	const userOpencode = userAgents.find((a) => a.id === "opencode");

	if (userOpencode) {
		// User overrides opencode - use only user-defined agents
		return {
			backends: userAgents.map(userAgentToBackendConfig),
			defaultId: userAgents[0].id,
		};
	}

	// User didn't define opencode - prepend default opencode to user agents
	return {
		backends: [defaultBackend, ...userAgents.map(userAgentToBackendConfig)],
		defaultId: defaultBackend.id,
	};
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

	// Merge backends
	const { backends, defaultId } = mergeBackends(
		DEFAULT_OPENCODE_BACKEND,
		userConfigResult.config?.agents,
	);

	// Override default if user specified one
	const resolvedDefaultId =
		userConfigResult.config?.defaultAgentId &&
		backends.some((b) => b.id === userConfigResult.config?.defaultAgentId)
			? userConfigResult.config.defaultAgentId
			: defaultId;

	// Get gateway URL (env var > credentials file > default production URL)
	const gatewayUrl = await getGatewayUrl();

	return {
		gatewayUrl,
		acpBackends: backends,
		defaultAcpBackendId: resolvedDefaultId,
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
	};
};
