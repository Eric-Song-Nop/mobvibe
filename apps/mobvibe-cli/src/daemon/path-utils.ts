import path from "node:path";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

const getPathModule = (cwd: string) =>
	cwd.startsWith("\\\\") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(cwd)
		? path.win32
		: path.posix;

const isWithinPosixCwd = (cwd: string, resolved: string) =>
	resolved === cwd || resolved.startsWith(`${cwd}/`);

const isWithinWindowsCwd = (cwd: string, resolved: string) => {
	const normalizedCwd = path.win32.normalize(cwd);
	const normalizedResolved = path.win32.normalize(resolved);
	const cwdRoot = path.win32.parse(normalizedCwd).root;
	const resolvedRoot = path.win32.parse(normalizedResolved).root;
	if (cwdRoot.toLowerCase() !== resolvedRoot.toLowerCase()) {
		return false;
	}

	const cwdRest = normalizedCwd.slice(cwdRoot.length);
	if (cwdRest === "") {
		return true;
	}

	const resolvedRest = normalizedResolved.slice(resolvedRoot.length);
	return resolvedRest === cwdRest || resolvedRest.startsWith(`${cwdRest}\\`);
};

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
	const isWithinCwd =
		pathModule === path.win32
			? isWithinWindowsCwd(normalizedCwd, resolved)
			: isWithinPosixCwd(normalizedCwd, resolved);
	if (!isWithinCwd) {
		throw new Error("Path escapes working directory");
	}
	return resolved;
};
