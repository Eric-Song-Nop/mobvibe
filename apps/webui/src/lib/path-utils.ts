import type { FsRoot } from "@mobvibe/shared";

export type PathSegment = {
	name: string;
	path: string;
};

const WINDOWS_DRIVE_PATH_RE = /^[a-z]:/i;
const WINDOWS_DRIVE_ROOT_RE = /^[a-z]:[\\/]*$/i;

const applySeparatorStyle = (value: string, separator: "\\" | "/") =>
	separator === "\\" ? value.replace(/\//g, "\\") : value.replace(/\\/g, "/");

const getPreferredSeparator = (value: string): "\\" | "/" =>
	value.includes("\\") ? "\\" : "/";

export const trimTrailingPathSeparators = (value: string) => {
	if (!value) {
		return value;
	}
	if (value === "/" || value === "\\") {
		return "/";
	}
	if (WINDOWS_DRIVE_ROOT_RE.test(value)) {
		return `${value.slice(0, 2)}${getPreferredSeparator(value)}`;
	}
	return value.replace(/[\\/]+$/g, "");
};

export const normalizePathForComparison = (value: string) => {
	const trimmedValue = trimTrailingPathSeparators(value);
	const normalizedValue = trimmedValue.replace(/\\/g, "/");
	if (WINDOWS_DRIVE_PATH_RE.test(normalizedValue)) {
		if (/^[a-z]:$/i.test(normalizedValue)) {
			return `${normalizedValue.toLowerCase()}/`;
		}
		return normalizedValue.toLowerCase();
	}
	return normalizedValue;
};

export const isPathAtRoot = (value: string, rootPath: string) =>
	normalizePathForComparison(value) === normalizePathForComparison(rootPath);

export const isPathWithinRoot = (value: string, rootPath: string) => {
	const normalizedValue = normalizePathForComparison(value);
	const normalizedRootPath = normalizePathForComparison(rootPath);
	if (normalizedValue === normalizedRootPath) {
		return true;
	}
	if (normalizedRootPath === "/") {
		return normalizedValue.startsWith("/");
	}
	const rootPrefix = normalizedRootPath.endsWith("/")
		? normalizedRootPath
		: `${normalizedRootPath}/`;
	return normalizedValue.startsWith(rootPrefix);
};

export const findBestMatchingRoot = <TRoot extends Pick<FsRoot, "path">>(
	roots: readonly TRoot[],
	value: string | undefined,
) => {
	if (!value) {
		return undefined;
	}
	return roots
		.filter((root) => isPathWithinRoot(value, root.path))
		.sort(
			(left, right) =>
				normalizePathForComparison(right.path).length -
				normalizePathForComparison(left.path).length,
		)[0];
};

export const appendPathSegment = (basePath: string, segment: string) => {
	const trimmedBasePath = trimTrailingPathSeparators(basePath);
	if (trimmedBasePath === "/") {
		return `/${segment}`;
	}
	if (/^[a-z]:[\\/]$/i.test(trimmedBasePath)) {
		return `${trimmedBasePath}${segment}`;
	}
	const separator = getPreferredSeparator(basePath);
	return `${trimmedBasePath}${separator}${segment}`;
};

export const buildPathSegments = (
	rootPath: string,
	targetPath: string,
	rootLabel: string,
): PathSegment[] => {
	const resolvedRootPath = trimTrailingPathSeparators(rootPath);
	const segments: PathSegment[] = [{ name: rootLabel, path: resolvedRootPath }];

	if (
		isPathAtRoot(targetPath, rootPath) ||
		!isPathWithinRoot(targetPath, rootPath)
	) {
		return segments;
	}

	const normalizedTargetPath = normalizePathForComparison(targetPath);
	const normalizedRootPath = normalizePathForComparison(rootPath);
	const relativePath = normalizedTargetPath.slice(
		normalizedRootPath.endsWith("/")
			? normalizedRootPath.length
			: normalizedRootPath.length + 1,
	);
	const parts = relativePath.split("/").filter(Boolean);
	const separator = getPreferredSeparator(targetPath);
	let currentPath = applySeparatorStyle(resolvedRootPath, separator);

	for (const part of parts) {
		currentPath = appendPathSegment(currentPath, part);
		segments.push({ name: part, path: currentPath });
	}

	return segments;
};
