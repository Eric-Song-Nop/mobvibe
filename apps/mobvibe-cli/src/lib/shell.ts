/**
 * Shell utilities for executing terminal commands through the user's shell.
 *
 * Instead of spawning commands directly (which fails on shell syntax like
 * `&&`, `|`, `2>&1`), we resolve the user's preferred shell and run
 * commands via `shell -c "..."`.
 */

/**
 * Resolve the shell to use for command execution.
 * Priority: MOBVIBE_SHELL env → SHELL env → /bin/sh fallback.
 */
export function resolveShell(): string {
	return process.env.MOBVIBE_SHELL || process.env.SHELL || "/bin/sh";
}

/**
 * POSIX-safe single-quote escaping for a shell argument.
 *
 * Safe tokens (alphanumeric, `-`, `_`, `/`, `.`, `:`, `=`) are returned
 * unquoted. Everything else is wrapped in single quotes with internal
 * single quotes escaped as `'\''`.
 */
export function posixQuote(arg: string): string {
	if (arg === "") {
		return "''";
	}
	if (/^[A-Za-z0-9\-_/.:=]+$/.test(arg)) {
		return arg;
	}
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Build a full command string for `shell -c`.
 *
 * When `args` is empty the command is passed through as-is (it may already
 * contain shell syntax). When args are present they are POSIX-quoted and
 * appended.
 */
export function buildShellCommand(command: string, args: string[]): string {
	if (args.length === 0) {
		return command;
	}
	const quotedArgs = args.map(posixQuote).join(" ");
	return `${command} ${quotedArgs}`;
}
