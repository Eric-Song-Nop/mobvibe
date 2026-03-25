import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	getGitRepoRoot,
	isGitRepo,
	resolveGitProjectContext,
} from "../git-utils.js";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
	await execFileAsync("git", args, { cwd });
}

async function createRepoFixture(): Promise<{
	rootDir: string;
	repoDir: string;
	worktreeDir: string;
	subdir: string;
}> {
	const rootDir = await mkdtemp(path.join(tmpdir(), "mobvibe-git-utils-"));
	const repoDir = path.join(rootDir, "project");
	const subdir = path.join(repoDir, "apps", "webui");
	const worktreeDir = path.join(rootDir, "worktrees", "feat-branch");

	await mkdir(subdir, { recursive: true });
	await writeFile(path.join(repoDir, "README.md"), "# test\n");
	await writeFile(path.join(subdir, ".gitkeep"), "");

	await execFileAsync("git", ["init", repoDir]);
	await runGit(repoDir, ["config", "user.name", "Mobvibe Test"]);
	await runGit(repoDir, ["config", "user.email", "test@mobvibe.local"]);
	await runGit(repoDir, ["add", "."]);
	await runGit(repoDir, ["commit", "-m", "init"]);

	return {
		rootDir,
		repoDir,
		worktreeDir,
		subdir,
	};
}

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("git project context", () => {
	it("returns true when directory is a git repo", async () => {
		const fixture = await createRepoFixture();
		tempDirs.push(fixture.rootDir);

		const result = await isGitRepo(fixture.repoDir);

		expect(result).toBe(true);
	});

	it("returns false when directory is not a git repo", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "mobvibe-git-utils-"));
		const dir = path.join(rootDir, "not-a-repo");
		tempDirs.push(rootDir);
		await mkdir(dir, { recursive: true });

		const result = await isGitRepo(dir);

		expect(result).toBe(false);
	});

	it("returns repo root for directories inside a git repo", async () => {
		const fixture = await createRepoFixture();
		tempDirs.push(fixture.rootDir);

		const result = await getGitRepoRoot(fixture.subdir);

		expect(result).toBe(fixture.repoDir);
	});

	it("returns undefined when cwd is not inside a git repo", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "mobvibe-git-utils-"));
		const dir = path.join(rootDir, "not-a-repo");
		tempDirs.push(rootDir);
		await mkdir(dir, { recursive: true });

		const result = await getGitRepoRoot(dir);

		expect(result).toBeUndefined();
	});

	it("resolves repo root and relative cwd for subdirectories", async () => {
		const fixture = await createRepoFixture();
		tempDirs.push(fixture.rootDir);

		const result = await resolveGitProjectContext(fixture.subdir);

		expect(result).toEqual({
			isGitRepo: true,
			repoRoot: fixture.repoDir,
			repoName: "project",
			relativeCwd: path.join("apps", "webui"),
			isRepoRoot: false,
		});
	});

	it("marks repo root directories correctly", async () => {
		const fixture = await createRepoFixture();
		tempDirs.push(fixture.rootDir);

		const result = await resolveGitProjectContext(fixture.repoDir);

		expect(result).toEqual({
			isGitRepo: true,
			repoRoot: fixture.repoDir,
			repoName: "project",
			relativeCwd: undefined,
			isRepoRoot: true,
		});
	});

	it("normalizes linked worktrees back to the primary project root", async () => {
		const fixture = await createRepoFixture();
		tempDirs.push(fixture.rootDir);
		await mkdir(path.dirname(fixture.worktreeDir), { recursive: true });
		await runGit(fixture.repoDir, [
			"worktree",
			"add",
			"-b",
			"feat-branch",
			fixture.worktreeDir,
		]);

		const result = await resolveGitProjectContext(
			path.join(fixture.worktreeDir, "apps", "webui"),
		);

		expect(result).toEqual({
			isGitRepo: true,
			repoRoot: fixture.repoDir,
			repoName: "project",
			relativeCwd: path.join("apps", "webui"),
			isRepoRoot: false,
		});
	});
});
