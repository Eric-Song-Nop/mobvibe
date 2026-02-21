import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
	GitBlameLine,
	GitBranch,
	GitCommitDetail,
	GitFileStatus,
	GitLogEntry,
	GitStashEntry,
	GitStatusExtended,
	GrepResult,
} from "@mobvibe/shared";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB buffer for large repos

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
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
		const { stdout } = await execFileAsync(
			"git",
			["branch", "--show-current"],
			{
				cwd,
				maxBuffer: MAX_BUFFER,
			},
		);
		const branch = stdout.trim();
		if (branch) {
			return branch;
		}
		// Detached HEAD state - try to get the short commit hash
		const { stdout: hashOut } = await execFileAsync(
			"git",
			["rev-parse", "--short", "HEAD"],
			{ cwd, maxBuffer: MAX_BUFFER },
		);
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
		const { stdout } = await execFileAsync(
			"git",
			["status", "--porcelain=v1"],
			{ cwd, maxBuffer: MAX_BUFFER },
		);
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
	rawDiff?: string;
}> {
	try {
		// Get diff against HEAD (includes both staged and unstaged changes)
		const relativePath = path.isAbsolute(filePath)
			? path.relative(cwd, filePath)
			: filePath;

		const { stdout } = await execFileAsync(
			"git",
			["diff", "HEAD", "--", relativePath],
			{ cwd, maxBuffer: MAX_BUFFER },
		);

		if (!stdout.trim()) {
			// No diff - file might be untracked, check status
			const { stdout: statusOut } = await execFileAsync(
				"git",
				["status", "--porcelain=v1", "--", relativePath],
				{ cwd, maxBuffer: MAX_BUFFER },
			);

			if (statusOut.startsWith("?") || statusOut.startsWith("A")) {
				// Untracked or newly added file - all lines are "added"
				const absPath = path.isAbsolute(filePath)
					? filePath
					: path.resolve(cwd, relativePath);
				const content = await readFile(absPath, "utf-8");
				const lines = content.split("\n").filter((l) => l.length > 0);
				const lineCount = lines.length;
				// Build synthetic unified diff for new/untracked files
				const syntheticDiff = [
					`--- /dev/null`,
					`+++ b/${relativePath}`,
					`@@ -0,0 +1,${lineCount} @@`,
					...lines.map((l) => `+${l}`),
				].join("\n");
				return {
					addedLines: Array.from({ length: lineCount }, (_, i) => i + 1),
					modifiedLines: [],
					deletedLines: [],
					rawDiff: syntheticDiff,
				};
			}

			return { addedLines: [], modifiedLines: [], deletedLines: [] };
		}

		return { ...parseDiffOutput(stdout), rawDiff: stdout };
	} catch {
		return { addedLines: [], modifiedLines: [], deletedLines: [] };
	}
}

// --- Extended git functions for P0-C RPC ---

const LOG_SEPARATOR = "---GIT_LOG_ENTRY---";
const LOG_FIELD_SEPARATOR = "---GIT_FIELD---";
const DEFAULT_MAX_COUNT = 50;

/**
 * Parse git log output into GitLogEntry array.
 */
function parseGitLogOutput(stdout: string): GitLogEntry[] {
	const entries: GitLogEntry[] = [];
	const blocks = stdout.split(LOG_SEPARATOR).filter((b) => b.trim());

	for (const block of blocks) {
		const fields = block.split(LOG_FIELD_SEPARATOR);
		if (fields.length < 6) continue;

		const entry: GitLogEntry = {
			hash: fields[0].trim(),
			shortHash: fields[1].trim(),
			author: fields[2].trim(),
			authorEmail: fields[3].trim(),
			date: fields[4].trim(),
			subject: fields[5].trim(),
			body: fields[6]?.trim() || undefined,
		};

		// Parse numstat if present (fields[7])
		const numstat = fields[7]?.trim();
		if (numstat) {
			let filesChanged = 0;
			let insertions = 0;
			let deletions = 0;
			for (const line of numstat.split("\n").filter(Boolean)) {
				const parts = line.split("\t");
				if (parts.length >= 2) {
					filesChanged++;
					const ins = Number.parseInt(parts[0], 10);
					const del = Number.parseInt(parts[1], 10);
					if (!Number.isNaN(ins)) insertions += ins;
					if (!Number.isNaN(del)) deletions += del;
				}
			}
			entry.filesChanged = filesChanged;
			entry.insertions = insertions;
			entry.deletions = deletions;
		}

		entries.push(entry);
	}

	return entries;
}

const LOG_FORMAT = `${LOG_SEPARATOR}%H${LOG_FIELD_SEPARATOR}%h${LOG_FIELD_SEPARATOR}%an${LOG_FIELD_SEPARATOR}%ae${LOG_FIELD_SEPARATOR}%aI${LOG_FIELD_SEPARATOR}%s${LOG_FIELD_SEPARATOR}%b${LOG_FIELD_SEPARATOR}`;

/**
 * Get git log entries.
 */
export async function getGitLog(
	cwd: string,
	opts?: {
		maxCount?: number;
		skip?: number;
		path?: string;
		author?: string;
		search?: string;
	},
): Promise<{ entries: GitLogEntry[]; hasMore: boolean }> {
	try {
		const maxCount = (opts?.maxCount ?? DEFAULT_MAX_COUNT) + 1; // +1 to detect hasMore
		const args = [
			"log",
			`--format=${LOG_FORMAT}`,
			"--numstat",
			`--max-count=${maxCount}`,
		];
		if (opts?.skip) args.push(`--skip=${opts.skip}`);
		if (opts?.author) args.push(`--author=${opts.author}`);
		if (opts?.search) args.push(`--grep=${opts.search}`);
		if (opts?.path) {
			args.push("--");
			args.push(opts.path);
		}

		const { stdout } = await execFileAsync("git", args, {
			cwd,
			maxBuffer: MAX_BUFFER,
		});

		const entries = parseGitLogOutput(stdout);
		const requestedMax = opts?.maxCount ?? DEFAULT_MAX_COUNT;
		const hasMore = entries.length > requestedMax;
		return {
			entries: hasMore ? entries.slice(0, requestedMax) : entries,
			hasMore,
		};
	} catch {
		return { entries: [], hasMore: false };
	}
}

/**
 * Get detailed commit information including file changes.
 */
export async function getGitShow(
	cwd: string,
	hash: string,
): Promise<GitCommitDetail | undefined> {
	try {
		// Get commit info with numstat and patch
		const { stdout: infoOut } = await execFileAsync(
			"git",
			["show", "--format=%H%n%h%n%an%n%ae%n%aI%n%s%n%b", "--numstat", hash],
			{ cwd, maxBuffer: MAX_BUFFER },
		);

		const lines = infoOut.split("\n");
		if (lines.length < 6) return undefined;

		// First 6 lines are commit info, then empty line, then numstat
		const commitHash = lines[0].trim();
		const shortHash = lines[1].trim();
		const author = lines[2].trim();
		const authorEmail = lines[3].trim();
		const date = lines[4].trim();
		const subject = lines[5].trim();

		// Body is between subject and the empty line before numstat
		let bodyEnd = 6;
		while (bodyEnd < lines.length && lines[bodyEnd].trim() !== "") {
			bodyEnd++;
		}
		const body = lines.slice(6, bodyEnd).join("\n").trim() || undefined;

		// Parse numstat (after the empty line)
		const files: GitCommitDetail["files"] = [];
		for (let i = bodyEnd + 1; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;
			const parts = line.split("\t");
			if (parts.length < 3) continue;

			const ins = Number.parseInt(parts[0], 10) || 0;
			const del = Number.parseInt(parts[1], 10) || 0;
			const filePath = parts[2];

			// Determine status from diff
			let status: "A" | "M" | "D" | "R" | "C" = "M";
			if (ins > 0 && del === 0) status = "A";
			else if (del > 0 && ins === 0) status = "D";

			files.push({
				path: filePath,
				status,
				insertions: ins,
				deletions: del,
			});
		}

		// Get patch output to attach diff per file
		try {
			const { stdout: patchOut } = await execFileAsync(
				"git",
				["show", "--format=", "--patch", hash],
				{ cwd, maxBuffer: MAX_BUFFER },
			);

			// Split patch into per-file diffs
			const fileDiffs = parsePerFileDiffs(patchOut);
			for (const file of files) {
				const diff = fileDiffs.get(file.path);
				if (diff) {
					file.diff = diff;
				}
			}
		} catch {
			// Patch retrieval failure is non-critical; files still returned without diff
		}

		return {
			hash: commitHash,
			shortHash,
			author,
			authorEmail,
			date,
			subject,
			body,
			filesChanged: files.length,
			insertions: files.reduce((s, f) => s + f.insertions, 0),
			deletions: files.reduce((s, f) => s + f.deletions, 0),
			files,
		};
	} catch {
		return undefined;
	}
}

/**
 * Parse combined patch output into per-file diff strings.
 * Returns a map from file path to its unified diff content.
 */
function parsePerFileDiffs(patchOutput: string): Map<string, string> {
	const result = new Map<string, string>();
	// Split on "diff --git" boundaries
	const parts = patchOutput.split(/^(?=diff --git )/m);

	for (const part of parts) {
		if (!part.startsWith("diff --git ")) continue;

		// Extract file path from "diff --git a/path b/path"
		const headerMatch = part.match(/^diff --git a\/.+ b\/(.+)/);
		if (!headerMatch) continue;

		const filePath = headerMatch[1].trim();
		result.set(filePath, part.trim());
	}

	return result;
}

/**
 * Get git blame for a file or line range.
 */
export async function getGitBlame(
	cwd: string,
	filePath: string,
	startLine?: number,
	endLine?: number,
): Promise<GitBlameLine[]> {
	try {
		const relativePath = path.isAbsolute(filePath)
			? path.relative(cwd, filePath)
			: filePath;

		const args = ["blame", "--porcelain"];
		if (startLine !== undefined && endLine !== undefined) {
			args.push(`-L${startLine},${endLine}`);
		} else if (startLine !== undefined) {
			args.push(`-L${startLine},`);
		}
		args.push("--", relativePath);

		const { stdout } = await execFileAsync("git", args, {
			cwd,
			maxBuffer: MAX_BUFFER,
		});

		const lines: GitBlameLine[] = [];
		const porcelainLines = stdout.split("\n");
		let i = 0;

		while (i < porcelainLines.length) {
			const headerMatch = porcelainLines[i].match(
				/^([a-f0-9]{40})\s+\d+\s+(\d+)/,
			);
			if (!headerMatch) {
				i++;
				continue;
			}

			const commitHash = headerMatch[1];
			const lineNumber = Number.parseInt(headerMatch[2], 10);
			let author = "";
			let date = "";
			let content = "";

			i++;
			// Read header fields until we hit the content line (starts with tab)
			while (i < porcelainLines.length) {
				const line = porcelainLines[i];
				if (line.startsWith("\t")) {
					content = line.slice(1);
					i++;
					break;
				}
				if (line.startsWith("author ")) {
					author = line.slice(7);
				} else if (line.startsWith("author-time ")) {
					const timestamp = Number.parseInt(line.slice(12), 10);
					date = new Date(timestamp * 1000).toISOString();
				}
				i++;
			}

			lines.push({
				lineNumber,
				commitHash,
				shortHash: commitHash.slice(0, 7),
				author,
				date,
				content,
			});
		}

		return lines;
	} catch {
		return [];
	}
}

/**
 * Get all git branches (local + remote).
 */
export async function getGitBranches(cwd: string): Promise<GitBranch[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			[
				"branch",
				"-a",
				"--format=%(refname:short)%(HEAD)%(upstream:short)%(upstream:track)",
			],
			{ cwd, maxBuffer: MAX_BUFFER },
		);

		const branches: GitBranch[] = [];

		for (const line of stdout.split("\n").filter(Boolean)) {
			// Parse the format: name*upstream[ahead N, behind M]
			const current = line.includes("*");
			const cleanLine = line.replace("*", "");

			// Simple parsing: first part is name, rest is upstream/tracking
			const parts = cleanLine.split(/(?=\[)/);
			const nameAndUpstream = parts[0].trim();
			const tracking = parts[1]?.trim() || "";

			// Check if remote branch
			const isRemote = nameAndUpstream.startsWith("origin/");

			// Parse ahead/behind
			let ahead = 0;
			let behind = 0;
			const trackMatch = tracking.match(
				/\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/,
			);
			if (trackMatch) {
				ahead = Number.parseInt(trackMatch[1] || "0", 10);
				behind = Number.parseInt(trackMatch[2] || trackMatch[3] || "0", 10);
			}

			branches.push({
				name: nameAndUpstream,
				current,
				remote: isRemote ? "origin" : undefined,
				aheadBehind: trackMatch ? { ahead, behind } : undefined,
			});
		}

		return branches;
	} catch {
		return [];
	}
}

/**
 * Get git stash list.
 */
export async function getGitStashList(cwd: string): Promise<GitStashEntry[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["stash", "list", "--format=%gd%n%gs%n%aI"],
			{ cwd, maxBuffer: MAX_BUFFER },
		);

		const entries: GitStashEntry[] = [];
		const lines = stdout.split("\n").filter(Boolean);

		for (let i = 0; i < lines.length - 2; i += 3) {
			const refMatch = lines[i].match(/stash@\{(\d+)\}/);
			const index = refMatch
				? Number.parseInt(refMatch[1], 10)
				: entries.length;
			const message = lines[i + 1] || "";
			const date = lines[i + 2] || "";

			entries.push({ index, message, date });
		}

		return entries;
	} catch {
		return [];
	}
}

/**
 * Get extended git status (staged/unstaged/untracked separated).
 */
export async function getGitStatusExtended(
	cwd: string,
): Promise<GitStatusExtended> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["status", "--porcelain=v1"],
			{ cwd, maxBuffer: MAX_BUFFER },
		);

		const staged: Array<{ path: string; status: GitFileStatus }> = [];
		const unstaged: Array<{ path: string; status: GitFileStatus }> = [];
		const untracked: Array<{ path: string }> = [];
		const allFiles: Array<{ path: string; status: GitFileStatus }> = [];

		for (const line of stdout.split("\n").filter(Boolean)) {
			const x = line[0]; // index status
			const y = line[1]; // work tree status
			const filePath = line.slice(3).split(" -> ").pop()?.trim();
			if (!filePath) continue;

			if (x === "?" && y === "?") {
				untracked.push({ path: filePath });
				allFiles.push({ path: filePath, status: "?" });
				continue;
			}

			// Staged changes (index column)
			if (x !== " " && x !== "?") {
				staged.push({ path: filePath, status: x as GitFileStatus });
			}

			// Unstaged changes (work tree column)
			if (y !== " " && y !== "?") {
				unstaged.push({ path: filePath, status: y as GitFileStatus });
			}

			// For dirStatus aggregation
			const status: GitFileStatus =
				x !== " " ? (x as GitFileStatus) : (y as GitFileStatus);
			allFiles.push({ path: filePath, status });
		}

		const branch = await getGitBranch(cwd);
		const dirStatus = aggregateDirStatus(allFiles);

		return { branch, staged, unstaged, untracked, dirStatus };
	} catch {
		return {
			staged: [],
			unstaged: [],
			untracked: [],
			dirStatus: {},
		};
	}
}

/**
 * Search git log by message, diff content, or author.
 */
export async function searchGitLog(
	cwd: string,
	query: string,
	type: "message" | "diff" | "author",
	maxCount?: number,
): Promise<GitLogEntry[]> {
	try {
		const args = [
			"log",
			`--format=${LOG_FORMAT}`,
			"--numstat",
			`--max-count=${maxCount ?? DEFAULT_MAX_COUNT}`,
		];

		switch (type) {
			case "message":
				args.push(`--grep=${query}`);
				break;
			case "diff":
				args.push(`-S${query}`);
				break;
			case "author":
				args.push(`--author=${query}`);
				break;
		}

		const { stdout } = await execFileAsync("git", args, {
			cwd,
			maxBuffer: MAX_BUFFER,
		});

		return parseGitLogOutput(stdout);
	} catch {
		return [];
	}
}

/**
 * Get file history (commits that touched a specific file).
 */
export async function getGitFileHistory(
	cwd: string,
	filePath: string,
	maxCount?: number,
): Promise<GitLogEntry[]> {
	try {
		const relativePath = path.isAbsolute(filePath)
			? path.relative(cwd, filePath)
			: filePath;

		const result = await getGitLog(cwd, {
			maxCount: maxCount ?? DEFAULT_MAX_COUNT,
			path: relativePath,
		});

		return result.entries;
	} catch {
		return [];
	}
}

/**
 * Search file contents using git grep.
 */
export async function searchFileContents(
	cwd: string,
	query: string,
	opts?: { caseSensitive?: boolean; regex?: boolean; glob?: string },
): Promise<{ results: GrepResult[]; truncated: boolean }> {
	const MAX_RESULTS = 500;
	try {
		const args = ["grep", "-n", "--column", `--max-count=${MAX_RESULTS}`];
		if (!opts?.caseSensitive) args.push("-i");
		if (!opts?.regex) args.push("-F"); // Fixed string (literal)
		if (opts?.glob) args.push(`--glob=${opts.glob}`);
		args.push("--", query);

		const { stdout } = await execFileAsync("git", args, {
			cwd,
			maxBuffer: MAX_BUFFER,
		});

		const results: GrepResult[] = [];
		for (const line of stdout.split("\n").filter(Boolean)) {
			// Format: file:line:column:content
			const match = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
			if (!match) continue;

			const matchPath = match[1];
			const lineNumber = Number.parseInt(match[2], 10);
			const column = Number.parseInt(match[3], 10);
			const content = match[4];

			results.push({
				path: matchPath,
				lineNumber,
				content,
				matchStart: column - 1, // git grep uses 1-based columns
				matchEnd: column - 1 + query.length,
			});
		}

		return { results, truncated: results.length >= MAX_RESULTS };
	} catch {
		return { results: [], truncated: false };
	}
}
