import os from "node:os";
import path from "node:path";
import type { AcpBackendId } from "@mobvibe/shared";
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

	// Detect backends from registry
	let backends: AcpBackendConfig[] = [];
	const registry = await getRegistry({ homePath });
	if (registry) {
		backends = await detectAgents(registry);
	}

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
