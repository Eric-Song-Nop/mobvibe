import fs from "node:fs/promises";
import path from "node:path";
import type { MobvibeUserConfig } from "@mobvibe/shared";
import { logger } from "./lib/logger.js";

export type ConfigLoadResult = {
	config: MobvibeUserConfig | null;
	errors: string[];
	path: string;
};

const CONFIG_FILENAME = ".config.json";

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

	// Validate worktreeBaseDir (optional string)
	if (record.worktreeBaseDir !== undefined) {
		if (typeof record.worktreeBaseDir !== "string") {
			errors.push("worktreeBaseDir: must be a string");
		} else if (record.worktreeBaseDir.trim().length > 0) {
			config.worktreeBaseDir = record.worktreeBaseDir.trim();
		}
	}

	// Validate enabledAgents (optional string[])
	if (record.enabledAgents !== undefined) {
		if (!Array.isArray(record.enabledAgents)) {
			errors.push("enabledAgents: must be an array of strings");
		} else if (
			!record.enabledAgents.every((item: unknown) => typeof item === "string")
		) {
			errors.push("enabledAgents: every element must be a string");
		} else {
			config.enabledAgents = record.enabledAgents as string[];
		}
	}

	if (errors.length > 0) {
		return { config: null, errors };
	}

	return { config, errors: [] };
};

/**
 * Merge-save a partial user config into the config file.
 * Reads existing config, merges the patch, and writes back.
 */
export const saveUserConfig = async (
	homePath: string,
	patch: Partial<MobvibeUserConfig>,
): Promise<void> => {
	const configPath = path.join(homePath, CONFIG_FILENAME);
	let existing: Record<string, unknown> = {};
	try {
		const content = await fs.readFile(configPath, "utf-8");
		existing = JSON.parse(content) as Record<string, unknown>;
	} catch {
		/* file doesn't exist or invalid JSON — start fresh */
	}
	const merged = { ...existing, ...patch };
	await fs.mkdir(path.dirname(configPath), { recursive: true });
	await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
};

export const loadUserConfig = async (
	homePath: string,
): Promise<ConfigLoadResult> => {
	const configPath = path.join(homePath, CONFIG_FILENAME);
	logger.debug({ configPath }, "loading config");

	try {
		const content = await fs.readFile(configPath, "utf-8");
		let parsed: unknown;

		try {
			parsed = JSON.parse(content);
		} catch {
			logger.warn({ configPath }, "invalid JSON in config file");
			return {
				config: null,
				errors: ["Invalid JSON in config file"],
				path: configPath,
			};
		}

		const { config, errors } = validateUserConfig(parsed);

		if (errors.length > 0) {
			logger.warn({ errors }, "config validation errors");
		}

		if (config) {
			logger.debug({ config }, "loaded config");
		}

		return { config, errors, path: configPath };
	} catch (error) {
		// File not found is not an error, just return null config
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			logger.debug({ configPath }, "no config file found");
			return { config: null, errors: [], path: configPath };
		}

		// Other errors (permissions, etc.)
		const message =
			error instanceof Error ? error.message : "Unknown error reading config";
		logger.warn({ configPath, error: message }, "error reading config");
		return { config: null, errors: [message], path: configPath };
	}
};
