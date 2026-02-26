/**
 * User-defined agent configuration for custom ACP backends.
 */
export type UserAgentConfig = {
	/** Unique identifier for this agent (e.g., "opencode", "my-agent") */
	id: string;
	/** Display label for UI (defaults to id if not provided) */
	label?: string;
	/** Command to execute (e.g., "opencode", "/custom/path/agent") */
	command: string;
	/** Command line arguments */
	args?: string[];
	/** Additional environment variables to pass to the process */
	env?: Record<string, string>;
};

/** Registry auto-detection settings */
export type RegistryConfig = {
	/** Disable registry auto-detection entirely */
	disabled?: boolean;
	/** Cache TTL in milliseconds (default: 3600000 = 1 hour) */
	cacheTtlMs?: number;
	/** Custom registry URL (overrides the default CDN) */
	url?: string;
};

/**
 * User configuration file format for $HOME/.mobvibe/.config.json
 */
export type MobvibeUserConfig = {
	/** List of agent configurations */
	agents?: UserAgentConfig[];
	/** Base directory for git worktrees (default: ~/.mobvibe/worktrees) */
	worktreeBaseDir?: string;
	/** Registry auto-detection settings */
	registry?: RegistryConfig;
};
