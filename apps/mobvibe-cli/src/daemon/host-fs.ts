import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
	FsEntriesResponse,
	FsEntry,
	FsPathSegment,
	HostFsRootsResponse,
} from "@mobvibe/shared";

export const WINDOWS_HOST_ROOT_PATH = "__mobvibe_host_root__";
export const WINDOWS_HOST_ROOT_NAME = "Computer";

const WINDOWS_DRIVE_LETTERS = Array.from({ length: 26 }, (_value, index) =>
	String.fromCharCode(65 + index),
);

const isWindowsPlatform = (platform: NodeJS.Platform = process.platform) =>
	platform === "win32";

const normalizeWindowsPath = (targetPath: string) =>
	path.win32.normalize(targetPath);

const listWindowsDrives = async (): Promise<FsEntry[]> => {
	const entries: Array<FsEntry | undefined> = await Promise.all(
		WINDOWS_DRIVE_LETTERS.map(async (letter): Promise<FsEntry | undefined> => {
			const drivePath = `${letter}:\\`;
			try {
				await fs.access(drivePath);
				return {
					name: `${letter}:`,
					path: drivePath,
					type: "directory",
					hidden: false,
				};
			} catch {
				return undefined;
			}
		}),
	);
	return entries.filter((entry): entry is FsEntry => Boolean(entry));
};

export const buildHostFsRoots = async (
	platform: NodeJS.Platform = process.platform,
	homePath = homedir(),
): Promise<HostFsRootsResponse> => {
	if (isWindowsPlatform(platform)) {
		return {
			homePath,
			roots: [{ name: WINDOWS_HOST_ROOT_NAME, path: WINDOWS_HOST_ROOT_PATH }],
		};
	}
	return {
		homePath,
		roots: [{ name: "Home", path: homePath }],
	};
};

export const buildWindowsPathSegments = (
	targetPath: string,
): FsPathSegment[] => {
	const normalizedTarget = normalizeWindowsPath(targetPath);
	const parsedTarget = path.win32.parse(normalizedTarget);
	const driveRoot = parsedTarget.root;
	if (!driveRoot) {
		return [
			{
				name: WINDOWS_HOST_ROOT_NAME,
				path: WINDOWS_HOST_ROOT_PATH,
				selectable: false,
			},
		];
	}

	const segments: FsPathSegment[] = [
		{
			name: WINDOWS_HOST_ROOT_NAME,
			path: WINDOWS_HOST_ROOT_PATH,
			selectable: false,
		},
		{
			name: driveRoot.replace(/[\\/]+$/, ""),
			path: driveRoot,
		},
	];

	const relativePath = normalizedTarget.slice(driveRoot.length);
	if (!relativePath) {
		return segments;
	}

	let currentPath = driveRoot;
	for (const part of relativePath.split(/[\\/]+/).filter(Boolean)) {
		currentPath = path.win32.join(currentPath, part);
		segments.push({
			name: part,
			path: currentPath,
		});
	}

	return segments;
};

export const buildHostFsEntries = async (
	requestPath: string,
	readDirectoryEntries: (dirPath: string) => Promise<FsEntry[]>,
	platform: NodeJS.Platform = process.platform,
	resolveWindowsDrives: () => Promise<FsEntry[]> = listWindowsDrives,
): Promise<FsEntriesResponse> => {
	if (!isWindowsPlatform(platform)) {
		const entries = await readDirectoryEntries(requestPath);
		return { path: requestPath, entries };
	}

	if (requestPath === WINDOWS_HOST_ROOT_PATH) {
		return {
			path: WINDOWS_HOST_ROOT_PATH,
			entries: await resolveWindowsDrives(),
		};
	}

	const normalizedPath = normalizeWindowsPath(requestPath);
	const entries = await readDirectoryEntries(normalizedPath);
	return {
		path: normalizedPath,
		entries,
		segments: buildWindowsPathSegments(normalizedPath),
	};
};
