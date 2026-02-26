import os from "node:os";
import type { RegistryPlatformKey } from "@mobvibe/shared";

/**
 * Map Node.js os.platform() + os.arch() to ACP Registry platform keys.
 * Returns null for unsupported combinations.
 */
const PLATFORM_MAP: Record<string, Record<string, RegistryPlatformKey>> = {
	darwin: {
		arm64: "darwin-aarch64",
		x64: "darwin-x86_64",
	},
	linux: {
		arm64: "linux-aarch64",
		x64: "linux-x86_64",
	},
	win32: {
		arm64: "windows-aarch64",
		x64: "windows-x86_64",
	},
};

export const getRegistryPlatformKey = (): RegistryPlatformKey | null => {
	const platform = os.platform();
	const arch = os.arch();
	return PLATFORM_MAP[platform]?.[arch] ?? null;
};
