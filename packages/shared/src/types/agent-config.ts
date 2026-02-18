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

/**
 * User configuration file format for $HOME/.mobvibe/.config.json
 */
export type MobvibeUserConfig = {
	/** List of agent configurations */
	agents?: UserAgentConfig[];
};
