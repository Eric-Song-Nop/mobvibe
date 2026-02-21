import path from "node:path";

/**
 * Resolve a request path within the given cwd.
 * Accepts both relative and absolute paths.
 * Rejects any path that resolves outside the cwd.
 */
export const resolveWithinCwd = (cwd: string, requestPath: string): string => {
	const resolved = path.isAbsolute(requestPath)
		? path.normalize(requestPath)
		: path.resolve(cwd, requestPath);
	if (resolved !== cwd && !resolved.startsWith(`${cwd}/`)) {
		throw new Error("Path escapes working directory");
	}
	return resolved;
};
