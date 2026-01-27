import fs from "node:fs/promises";
import path from "node:path";
import type { MobvibeUserConfig, UserAgentConfig } from "@mobvibe/shared";

export type ConfigLoadResult = {
	config: MobvibeUserConfig | null;
	errors: string[];
	path: string;
};

const CONFIG_FILENAME = ".config.json";

const validateAgentConfig = (
	agent: unknown,
	index: number,
): { valid: UserAgentConfig | null; errors: string[] } => {
	const errors: string[] = [];
	const prefix = `agents[${index}]`;

	if (typeof agent !== "object" || agent === null) {
		errors.push(`${prefix}: must be an object`);
		return { valid: null, errors };
	}

	const record = agent as Record<string, unknown>;

	// Validate id (required)
	if (typeof record.id !== "string" || record.id.trim().length === 0) {
		errors.push(`${prefix}.id: must be a non-empty string`);
		return { valid: null, errors };
	}

	// Validate command (required)
	if (
		typeof record.command !== "string" ||
		record.command.trim().length === 0
	) {
		errors.push(`${prefix}.command: must be a non-empty string`);
		return { valid: null, errors };
	}

	const validated: UserAgentConfig = {
		id: record.id.trim(),
		command: record.command.trim(),
	};

	// Validate label (optional string)
	if (record.label !== undefined) {
		if (typeof record.label !== "string") {
			errors.push(`${prefix}.label: must be a string`);
		} else if (record.label.trim().length > 0) {
			validated.label = record.label.trim();
		}
	}

	// Validate args (optional string array)
	if (record.args !== undefined) {
		if (!Array.isArray(record.args)) {
			errors.push(`${prefix}.args: must be an array of strings`);
		} else {
			const validArgs = record.args.filter((arg): arg is string => {
				if (typeof arg !== "string") {
					errors.push(`${prefix}.args: all elements must be strings`);
					return false;
				}
				return true;
			});
			if (validArgs.length > 0) {
				validated.args = validArgs;
			}
		}
	}

	// Validate env (optional object with string values)
	if (record.env !== undefined) {
		if (typeof record.env !== "object" || record.env === null) {
			errors.push(`${prefix}.env: must be an object`);
		} else {
			const envRecord = record.env as Record<string, unknown>;
			const validEnv: Record<string, string> = {};
			let hasEnv = false;
			for (const [key, value] of Object.entries(envRecord)) {
				if (typeof value !== "string") {
					errors.push(`${prefix}.env.${key}: must be a string`);
				} else {
					validEnv[key] = value;
					hasEnv = true;
				}
			}
			if (hasEnv) {
				validated.env = validEnv;
			}
		}
	}

	// Return null if there were any errors after id/command validation
	if (errors.length > 0) {
		return { valid: null, errors };
	}

	return { valid: validated, errors: [] };
};

const validateUserConfig = (
	data: unknown,
): { config: MobvibeUserConfig | null; errors: string[] } => {
	const errors: string[] = [];

	if (typeof data !== "object" || data === null) {
		errors.push("config: must be an object");
		return { config: null, errors };
	}

	const record = data as Record<string, unknown>;
	const config: MobvibeUserConfig = {};

	// Validate agents array
	if (record.agents !== undefined) {
		if (!Array.isArray(record.agents)) {
			errors.push("agents: must be an array");
		} else {
			const validAgents: UserAgentConfig[] = [];
			const seenIds = new Set<string>();

			for (let i = 0; i < record.agents.length; i++) {
				const result = validateAgentConfig(record.agents[i], i);
				errors.push(...result.errors);

				if (result.valid) {
					if (seenIds.has(result.valid.id)) {
						errors.push(`agents[${i}].id: duplicate id "${result.valid.id}"`);
					} else {
						seenIds.add(result.valid.id);
						validAgents.push(result.valid);
					}
				}
			}

			if (validAgents.length > 0) {
				config.agents = validAgents;
			}
		}
	}

	// Validate defaultAgentId
	if (record.defaultAgentId !== undefined) {
		if (typeof record.defaultAgentId !== "string") {
			errors.push("defaultAgentId: must be a string");
		} else if (record.defaultAgentId.trim().length > 0) {
			config.defaultAgentId = record.defaultAgentId.trim();
		}
	}

	if (errors.length > 0) {
		return { config: null, errors };
	}

	return { config, errors: [] };
};

export const loadUserConfig = async (
	homePath: string,
): Promise<ConfigLoadResult> => {
	const configPath = path.join(homePath, CONFIG_FILENAME);

	try {
		const content = await fs.readFile(configPath, "utf-8");
		let parsed: unknown;

		try {
			parsed = JSON.parse(content);
		} catch {
			return {
				config: null,
				errors: ["Invalid JSON in config file"],
				path: configPath,
			};
		}

		const { config, errors } = validateUserConfig(parsed);
		return { config, errors, path: configPath };
	} catch (error) {
		// File not found is not an error, just return null config
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { config: null, errors: [], path: configPath };
		}

		// Other errors (permissions, etc.)
		const message =
			error instanceof Error ? error.message : "Unknown error reading config";
		return { config: null, errors: [message], path: configPath };
	}
};
