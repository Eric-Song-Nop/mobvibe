import type { RegistryAgent, RegistryData } from "@mobvibe/shared";
import type { AcpBackendConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { getRegistryPlatformKey } from "./platform.js";

/**
 * Resolve the launch command for a registry agent.
 *
 * Priority: binary (fastest startup) > npx > uvx
 * Returns null if no usable distribution found for this platform/toolchain.
 */
export const resolveAgentCommand = (
	agent: RegistryAgent,
	platformKey: string | null,
	hasNpx: boolean,
	hasUvx: boolean,
): Pick<AcpBackendConfig, "command" | "args" | "envOverrides"> | null => {
	const { distribution } = agent;

	// 1. Binary — only if we have a platform key and the binary exists for it
	if (distribution.binary && platformKey) {
		const entry = distribution.binary[platformKey];
		if (entry) {
			// Registry cmd may use "./" prefix (archive-relative); strip it for PATH lookup
			const cmdName = entry.cmd.replace(/^\.\//, "");
			// Bun.which() cannot resolve names with path separators; fall back to basename
			const baseName =
				cmdName.includes("/") || cmdName.includes("\\")
					? cmdName.split(/[/\\]/).pop()!
					: cmdName;
			const binPath = Bun.which(baseName);
			if (binPath) {
				return {
					command: baseName,
					args: entry.args ?? [],
					envOverrides:
						entry.env && Object.keys(entry.env).length > 0
							? entry.env
							: undefined,
				};
			}
		}
	}

	// 2. npx — available as long as npx is installed (downloads on demand)
	if (distribution.npx && hasNpx) {
		const { package: pkg, args, env } = distribution.npx;
		return {
			command: "npx",
			args: ["-y", pkg, ...(args ?? [])],
			envOverrides: env && Object.keys(env).length > 0 ? env : undefined,
		};
	}

	// 3. uvx
	if (distribution.uvx && hasUvx) {
		const { package: pkg, args, env } = distribution.uvx;
		return {
			command: "uvx",
			args: [pkg, ...(args ?? [])],
			envOverrides: env && Object.keys(env).length > 0 ? env : undefined,
		};
	}

	return null;
};

/**
 * Detect available ACP agents from the registry.
 *
 * - binary-only agents: only available if the binary is in PATH
 * - npx agents: all available if `npx` is in PATH (npx downloads on demand)
 * - uvx agents: all available if `uvx` is in PATH
 * - multi-distribution agents: prefer binary > npx > uvx
 */
export const detectAgents = async (
	registry: RegistryData,
): Promise<AcpBackendConfig[]> => {
	const platformKey = getRegistryPlatformKey();
	const hasNpx = Bun.which("npx") !== null;
	const hasUvx = Bun.which("uvx") !== null;

	logger.debug({ platformKey, hasNpx, hasUvx }, "agent_detector_environment");

	const results: AcpBackendConfig[] = [];

	for (const agent of registry.agents) {
		const resolved = resolveAgentCommand(agent, platformKey, hasNpx, hasUvx);
		if (!resolved) continue;

		results.push({
			id: agent.id,
			label: agent.name,
			icon: agent.icon,
			description: agent.description,
			...resolved,
		});
	}

	logger.info(
		{ detected: results.length, total: registry.agents.length },
		"agents_detected",
	);

	return results;
};

export type ResolveResult = {
	resolved: AcpBackendConfig[];
	failed: RegistryAgent[];
};

/**
 * Resolve launch commands for a subset of registry agents (selected by user).
 *
 * Returns both successfully resolved backends and agents that could not be resolved,
 * so the caller can warn the user about missing toolchains (binary not in PATH, etc.).
 */
export const resolveSelectedAgents = (
	agents: RegistryAgent[],
	selectedIds: string[],
): ResolveResult => {
	const platformKey = getRegistryPlatformKey();
	const hasNpx = Bun.which("npx") !== null;
	const hasUvx = Bun.which("uvx") !== null;

	const selected = agents.filter((a) => selectedIds.includes(a.id));
	const resolved: AcpBackendConfig[] = [];
	const failed: RegistryAgent[] = [];

	for (const agent of selected) {
		const cmd = resolveAgentCommand(agent, platformKey, hasNpx, hasUvx);
		if (cmd) {
			resolved.push({
				id: agent.id,
				label: agent.name,
				icon: agent.icon,
				description: agent.description,
				...cmd,
			});
		} else {
			failed.push(agent);
		}
	}

	return { resolved, failed };
};
