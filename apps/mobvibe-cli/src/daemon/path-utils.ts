import path from "node:path";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

const getPathModule = (cwd: string) =>
	cwd.startsWith("\\\\") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(cwd)
		? path.win32
		: path.posix;

/**
 * Resolve a request path within the given cwd.
 * Accepts both relative and absolute paths.
 * Rejects any path that resolves outside the cwd.
 */
export const resolveWithinCwd = (cwd: string, requestPath: string): string => {
	const pathModule = getPathModule(cwd);
	const normalizedCwd = pathModule.resolve(cwd);
	const resolved = pathModule.isAbsolute(requestPath)
		? pathModule.normalize(requestPath)
		: pathModule.resolve(normalizedCwd, requestPath);
	const relative = pathModule.relative(normalizedCwd, resolved);
	if (
		relative !== "" &&
		(relative === ".." ||
			relative.startsWith(`..${pathModule.sep}`) ||
			pathModule.isAbsolute(relative))
	) {
		throw new Error("Path escapes working directory");
	}
	return resolved;
};
