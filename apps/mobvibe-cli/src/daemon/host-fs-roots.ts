import fs from "node:fs/promises";
import { homedir } from "node:os";
import type { HostFsRootsResponse } from "@mobvibe/shared";

type HostFsRootsDeps = {
	platform: NodeJS.Platform | string;
	homePath: string;
	stat: (path: string) => Promise<{ isDirectory: () => boolean }>;
	access: (path: string) => Promise<void>;
};

const WINDOWS_DRIVE_LETTERS = Array.from({ length: 26 }, (_value, index) =>
	String.fromCharCode(65 + index),
);

const normalizeWindowsPathForDedup = (value: string) =>
	value.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();

const canAccessDirectory = async (
	rootPath: string,
	deps: Pick<HostFsRootsDeps, "stat" | "access">,
) => {
	try {
		const stats = await deps.stat(rootPath);
		if (!stats.isDirectory()) {
			return false;
		}
		await deps.access(rootPath);
		return true;
	} catch {
		return false;
	}
};

const listWindowsDriveRoots = async (
	deps: Pick<HostFsRootsDeps, "stat" | "access">,
) => {
	const discovered = await Promise.all(
		WINDOWS_DRIVE_LETTERS.map(async (driveLetter) => {
			const rootPath = `${driveLetter}:\\`;
			const isAccessible = await canAccessDirectory(rootPath, deps);
			return isAccessible
				? {
						name: `${driveLetter}:`,
						path: rootPath,
					}
				: undefined;
		}),
	);

	return discovered
		.filter((root): root is NonNullable<typeof root> => Boolean(root))
		.sort((left, right) => left.path.localeCompare(right.path));
};

export const discoverHostFsRoots = async ({
	platform,
	homePath,
	stat,
	access,
}: HostFsRootsDeps): Promise<HostFsRootsResponse> => {
	const homeRoot = { name: "Home", path: homePath };
	if (platform !== "win32") {
		return {
			homePath,
			roots: [homeRoot],
		};
	}

	const roots = [homeRoot, ...(await listWindowsDriveRoots({ stat, access }))];
	const seenPaths = new Set<string>();

	return {
		homePath,
		roots: roots.filter((root) => {
			const normalizedPath = normalizeWindowsPathForDedup(root.path);
			if (seenPaths.has(normalizedPath)) {
				return false;
			}
			seenPaths.add(normalizedPath);
			return true;
		}),
	};
};

export const buildHostFsRoots = () =>
	discoverHostFsRoots({
		platform: process.platform,
		homePath: homedir(),
		stat: fs.stat,
		access: fs.access,
	});
