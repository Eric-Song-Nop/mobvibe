import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GitFileStatus } from "@mobvibe/shared";

const execAsync = promisify(exec);
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB buffer for large repos

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
	try {
		await execAsync("git rev-parse --is-inside-work-tree", {
			cwd,
			maxBuffer: MAX_BUFFER,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Get the current git branch name.
 */
export async function getGitBranch(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execAsync("git branch --show-current", {
			cwd,
			maxBuffer: MAX_BUFFER,
		});
		const branch = stdout.trim();
		if (branch) {
			return branch;
		}
		// Detached HEAD state - try to get the short commit hash
		const { stdout: hashOut } = await execAsync("git rev-parse --short HEAD", {
			cwd,
			maxBuffer: MAX_BUFFER,
		});
		return hashOut.trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Parse git status --porcelain output to extract file statuses.
 */
function parseGitStatus(
	output: string,
): Array<{ path: string; status: GitFileStatus }> {
	const files: Array<{ path: string; status: GitFileStatus }> = [];
	const lines = output.split("\n").filter((line) => line.length > 0);

	for (const line of lines) {
		// Format: XY path or XY original -> renamed
		const indexStatus = line[0];
		const workTreeStatus = line[1];
		const filePath = line.slice(3).split(" -> ").pop()?.trim();

		if (!filePath) {
			continue;
		}

		// Determine the most significant status
		let status: GitFileStatus;
		if (indexStatus === "?" || workTreeStatus === "?") {
			status = "?";
		} else if (indexStatus === "!" || workTreeStatus === "!") {
			status = "!";
		} else if (indexStatus === "A" || workTreeStatus === "A") {
			status = "A";
		} else if (indexStatus === "D" || workTreeStatus === "D") {
			status = "D";
		} else if (indexStatus === "R" || workTreeStatus === "R") {
			status = "R";
		} else if (indexStatus === "C" || workTreeStatus === "C") {
			status = "C";
		} else if (indexStatus === "U" || workTreeStatus === "U") {
			status = "U";
		} else if (
			indexStatus === "M" ||
			workTreeStatus === "M" ||
			indexStatus !== " " ||
			workTreeStatus !== " "
		) {
			status = "M";
		} else {
			continue;
		}

		files.push({ path: filePath, status });
	}

	return files;
}

/**
 * Get git status for all files in the repository.
 */
export async function getGitStatus(
	cwd: string,
): Promise<Array<{ path: string; status: GitFileStatus }>> {
	try {
		const { stdout } = await execAsync("git status --porcelain=v1", {
			cwd,
			maxBuffer: MAX_BUFFER,
		});
		return parseGitStatus(stdout);
	} catch {
		return [];
	}
}

/**
 * Aggregate file statuses into directory statuses.
 * A directory gets the "highest priority" status of its children.
 */
export function aggregateDirStatus(
	files: Array<{ path: string; status: GitFileStatus }>,
): Record<string, GitFileStatus> {
	const dirStatus: Record<string, GitFileStatus> = {};

	// Priority order: A > D > M > R > C > U > ? > !
	const statusPriority: Record<GitFileStatus, number> = {
		A: 7,
		D: 6,
		M: 5,
		R: 4,
		C: 3,
		U: 2,
		"?": 1,
		"!": 0,
	};

	for (const file of files) {
		// Build all parent directories
		const parts = file.path.split("/");
		let currentPath = "";

		for (let i = 0; i < parts.length - 1; i++) {
			currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
			const existing = dirStatus[currentPath];

			if (!existing || statusPriority[file.status] > statusPriority[existing]) {
				dirStatus[currentPath] = file.status;
			}
		}
	}

	return dirStatus;
}

/**
 * Parse git diff output to extract added, modified, and deleted line numbers.
 * Deleted lines are recorded at the position where the deletion occurred in the new file.
 */
function parseDiffOutput(diffOutput: string): {
	addedLines: number[];
	modifiedLines: number[];
	deletedLines: number[];
} {
	const addedLines: number[] = [];
	const modifiedLines: number[] = [];
	const deletedLines: number[] = [];

	const lines = diffOutput.split("\n");
	let currentLine = 0;
	let inHunk = false;
	let pendingDeletionLine = 0;

	for (const line of lines) {
		// Parse hunk header: @@ -start,count +start,count @@
		const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
		if (hunkMatch) {
			currentLine = Number.parseInt(hunkMatch[1], 10);
			inHunk = true;
			pendingDeletionLine = 0;
			continue;
		}

		if (!inHunk) {
			continue;
		}

		if (line.startsWith("+") && !line.startsWith("+++")) {
			// Added line
			addedLines.push(currentLine);
			currentLine++;
			pendingDeletionLine = 0;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			// Deleted line - record the current new file position
			// If we're at a deletion, mark the position where content was removed
			if (pendingDeletionLine === 0) {
				pendingDeletionLine = currentLine;
			}
			// Record deletion at the current line position (or previous line if at start)
			const deletionPos = Math.max(1, currentLine);
			if (!deletedLines.includes(deletionPos)) {
				deletedLines.push(deletionPos);
			}
		} else if (!line.startsWith("\\")) {
			// Context line or empty line
			currentLine++;
			pendingDeletionLine = 0;
		}
	}

	return { addedLines, modifiedLines, deletedLines };
}

/**
 * Get git diff for a specific file.
 */
export async function getFileDiff(
	cwd: string,
	filePath: string,
): Promise<{
	addedLines: number[];
	modifiedLines: number[];
	deletedLines: number[];
}> {
	try {
		// Get diff against HEAD (includes both staged and unstaged changes)
		const relativePath = path.isAbsolute(filePath)
			? path.relative(cwd, filePath)
			: filePath;

		const { stdout } = await execAsync(`git diff HEAD -- "${relativePath}"`, {
			cwd,
			maxBuffer: MAX_BUFFER,
		});

		if (!stdout.trim()) {
			// No diff - file might be untracked, check status
			const { stdout: statusOut } = await execAsync(
				`git status --porcelain=v1 -- "${relativePath}"`,
				{ cwd, maxBuffer: MAX_BUFFER },
			);

			if (statusOut.startsWith("?") || statusOut.startsWith("A")) {
				// Untracked or newly added file - all lines are "added"
				const { stdout: wcOut } = await execAsync(`wc -l < "${relativePath}"`, {
					cwd,
					maxBuffer: MAX_BUFFER,
				});
				const lineCount = Number.parseInt(wcOut.trim(), 10) || 0;
				return {
					addedLines: Array.from({ length: lineCount }, (_, i) => i + 1),
					modifiedLines: [],
					deletedLines: [],
				};
			}

			return { addedLines: [], modifiedLines: [], deletedLines: [] };
		}

		return parseDiffOutput(stdout);
	} catch {
		return { addedLines: [], modifiedLines: [], deletedLines: [] };
	}
}
