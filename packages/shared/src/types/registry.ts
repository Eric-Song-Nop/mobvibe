/**
 * ACP Registry types — matches the CDN JSON at
 * https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
 */

/** Distribution descriptor for npx-based agents */
export type NpxDistribution = {
	package: string;
	args?: string[];
	env?: Record<string, string>;
};

/** Platform-specific binary distribution */
export type BinaryPlatformEntry = {
	archive: string;
	cmd: string;
	args?: string[];
	env?: Record<string, string>;
};

/** Distribution descriptor for uvx-based agents */
export type UvxDistribution = {
	package: string;
	args?: string[];
	env?: Record<string, string>;
};

/** Known platform keys in the binary distribution map */
export type RegistryPlatformKey =
	| "darwin-aarch64"
	| "darwin-x86_64"
	| "linux-aarch64"
	| "linux-x86_64"
	| "windows-aarch64"
	| "windows-x86_64";

/** A single agent entry in the registry */
export type RegistryAgent = {
	id: string;
	name: string;
	version: string;
	description: string;
	repository?: string;
	authors?: string[];
	license?: string;
	icon?: string;
	distribution: {
		npx?: NpxDistribution;
		binary?: Record<string, BinaryPlatformEntry>;
		uvx?: UvxDistribution;
	};
};

/** Top-level registry document */
export type RegistryData = {
	version: string;
	agents: RegistryAgent[];
	extensions: unknown[];
};
