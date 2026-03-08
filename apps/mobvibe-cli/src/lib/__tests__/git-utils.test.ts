import { beforeEach, describe, expect, it, mock } from "bun:test";

type ExecFileResult = { stdout: string; stderr: string };

const execFileQueue: Array<ExecFileResult | Error> = [];
const mockReadFile = mock(() => Promise.resolve(""));
const mockExecFileAsync = mock(() => {
	const next = execFileQueue.shift() ?? { stdout: "", stderr: "" };
	if (next instanceof Error) {
		return Promise.reject(next);
	}
	return Promise.resolve(next);
});

mock.module("../git-io.js", () => ({
	execFileAsync: mockExecFileAsync,
	readFileText: mockReadFile,
}));

const {
	isGitRepo,
	getGitRepoRoot,
	getGitBranch,
	getGitStatus,
	getFileDiff,
	aggregateDirStatus,
	resolveGitProjectContext,
	validateGitRef,
} = await import("../git-utils.js");

describe("git-utils", () => {
	beforeEach(() => {
		mockExecFileAsync.mockClear();
		execFileQueue.length = 0;
		mockReadFile.mockClear();
	});

	describe("isGitRepo", () => {
		it("returns true when directory is a git repo", async () => {
			execFileQueue.push({ stdout: "true\n", stderr: "" });

			const result = await isGitRepo("/home/user/project");

			expect(result).toBe(true);
			expect(mockExecFileAsync).toHaveBeenCalledWith(
				"git",
				["rev-parse", "--is-inside-work-tree"],
				expect.objectContaining({ cwd: "/home/user/project" }),
			);
		});

		it("returns false when directory is not a git repo", async () => {
			execFileQueue.push(new Error("Not a git repository"));

			const result = await isGitRepo("/home/user/not-a-repo");

			expect(result).toBe(false);
		});
	});

	describe("getGitRepoRoot", () => {
		it("returns repo root for directories inside a git repo", async () => {
			execFileQueue.push({
				stdout: "/home/user/project\n",
				stderr: "",
			});

			const result = await getGitRepoRoot("/home/user/project/apps/webui");

			expect(result).toBe("/home/user/project");
		});

		it("returns undefined when cwd is not inside a git repo", async () => {
			execFileQueue.push(new Error("not a git repo"));

			const result = await getGitRepoRoot("/home/user/not-a-repo");

			expect(result).toBeUndefined();
		});
	});

	describe("resolveGitProjectContext", () => {
		it("resolves repo root and relative cwd for subdirectories", async () => {
			execFileQueue.push(
				{
					stdout: "/home/user/project\n",
					stderr: "",
				},
				{
					stdout: "worktree /home/user/project\n",
					stderr: "",
				},
			);

			const result = await resolveGitProjectContext(
				"/home/user/project/apps/webui",
			);

			expect(result).toEqual({
				isGitRepo: true,
				repoRoot: "/home/user/project",
				repoName: "project",
				relativeCwd: "apps/webui",
				isRepoRoot: false,
			});
		});

		it("marks repo root directories correctly", async () => {
			execFileQueue.push(
				{
					stdout: "/home/user/project\n",
					stderr: "",
				},
				{
					stdout: "worktree /home/user/project\n",
					stderr: "",
				},
			);

			const result = await resolveGitProjectContext("/home/user/project");

			expect(result).toEqual({
				isGitRepo: true,
				repoRoot: "/home/user/project",
				repoName: "project",
				relativeCwd: undefined,
				isRepoRoot: true,
			});
		});

		it("normalizes linked worktrees back to the primary project root", async () => {
			execFileQueue.push(
				{
					stdout: "/tmp/worktrees/project/feat-branch\n",
					stderr: "",
				},
				{
					stdout:
						"worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\nworktree /tmp/worktrees/project/feat-branch\nHEAD def456\nbranch refs/heads/feat-branch\n",
					stderr: "",
				},
			);

			const result = await resolveGitProjectContext(
				"/tmp/worktrees/project/feat-branch/apps/webui",
			);

			expect(result).toEqual({
				isGitRepo: true,
				repoRoot: "/home/user/project",
				repoName: "project",
				relativeCwd: "apps/webui",
				isRepoRoot: false,
			});
		});
	});

	describe("getGitBranch", () => {
		it("returns branch name when on a branch", async () => {
			execFileQueue.push({ stdout: "main\n", stderr: "" });

			const result = await getGitBranch("/home/user/project");

			expect(result).toBe("main");
			expect(mockExecFileAsync).toHaveBeenCalledWith(
				"git",
				["branch", "--show-current"],
				expect.objectContaining({ cwd: "/home/user/project" }),
			);
		});

		it("returns short commit hash when in detached HEAD state", async () => {
			execFileQueue.push(
				{ stdout: "\n", stderr: "" },
				{ stdout: "abc1234\n", stderr: "" },
			);

			const result = await getGitBranch("/home/user/project");

			expect(result).toBe("abc1234");
		});

		it("returns undefined when git command fails", async () => {
			execFileQueue.push(new Error("Git error"));

			const result = await getGitBranch("/home/user/project");

			expect(result).toBeUndefined();
		});
	});

	describe("getGitStatus", () => {
		it("parses modified files correctly", async () => {
			execFileQueue.push({
				stdout: " M src/file1.ts\nM  src/file2.ts\nMM src/file3.ts\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([
				{ path: "src/file1.ts", status: "M" },
				{ path: "src/file2.ts", status: "M" },
				{ path: "src/file3.ts", status: "M" },
			]);
		});

		it("parses added files correctly", async () => {
			execFileQueue.push({
				stdout: "A  src/new-file.ts\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([{ path: "src/new-file.ts", status: "A" }]);
		});

		it("parses deleted files correctly", async () => {
			execFileQueue.push({
				stdout: " D src/deleted.ts\nD  src/staged-delete.ts\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([
				{ path: "src/deleted.ts", status: "D" },
				{ path: "src/staged-delete.ts", status: "D" },
			]);
		});

		it("parses untracked files correctly", async () => {
			execFileQueue.push({
				stdout: "?? src/untracked.ts\n?? docs/\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([
				{ path: "src/untracked.ts", status: "?" },
				{ path: "docs/", status: "?" },
			]);
		});

		it("parses renamed files correctly", async () => {
			execFileQueue.push({
				stdout: "R  old-name.ts -> new-name.ts\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([{ path: "new-name.ts", status: "R" }]);
		});

		it("returns empty array when git command fails", async () => {
			execFileQueue.push(new Error("Git error"));

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([]);
		});

		it("handles mixed status output", async () => {
			execFileQueue.push({
				stdout:
					" M src/modified.ts\nA  src/added.ts\n D src/deleted.ts\n?? src/untracked.ts\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([
				{ path: "src/modified.ts", status: "M" },
				{ path: "src/added.ts", status: "A" },
				{ path: "src/deleted.ts", status: "D" },
				{ path: "src/untracked.ts", status: "?" },
			]);
		});
	});

	describe("aggregateDirStatus", () => {
		it("aggregates file statuses to parent directories", () => {
			const files = [
				{ path: "src/components/Button.tsx", status: "M" as const },
				{ path: "src/components/Input.tsx", status: "A" as const },
				{ path: "src/utils/helper.ts", status: "M" as const },
			];

			const result = aggregateDirStatus(files);

			expect(result).toEqual({
				src: "A",
				"src/components": "A",
				"src/utils": "M",
			});
		});

		it("uses highest priority status for directories", () => {
			const files = [
				{ path: "src/file1.ts", status: "M" as const },
				{ path: "src/file2.ts", status: "D" as const },
				{ path: "src/file3.ts", status: "?" as const },
			];

			const result = aggregateDirStatus(files);

			expect(result.src).toBe("D");
		});

		it("returns empty object for empty file list", () => {
			const result = aggregateDirStatus([]);

			expect(result).toEqual({});
		});

		it("handles deeply nested paths", () => {
			const files = [{ path: "a/b/c/d/file.ts", status: "M" as const }];

			const result = aggregateDirStatus(files);

			expect(result).toEqual({
				a: "M",
				"a/b": "M",
				"a/b/c": "M",
				"a/b/c/d": "M",
			});
		});
	});

	describe("validateGitRef", () => {
		it("accepts a normal branch name", () => {
			expect(() => validateGitRef("feat/my-feature")).not.toThrow();
			expect(() => validateGitRef("main")).not.toThrow();
			expect(() => validateGitRef("release-1.0")).not.toThrow();
		});

		it("rejects names starting with '-'", () => {
			expect(() => validateGitRef("-malicious")).toThrow(
				'cannot start with "-"',
			);
			expect(() => validateGitRef("--flag")).toThrow('cannot start with "-"');
		});

		it("rejects names containing '..'", () => {
			expect(() => validateGitRef("a..b")).toThrow('cannot contain ".."');
		});

		it("rejects empty string", () => {
			expect(() => validateGitRef("")).toThrow("cannot be empty");
			expect(() => validateGitRef("   ")).toThrow("cannot be empty");
		});

		it("rejects names ending with '.lock'", () => {
			expect(() => validateGitRef("branch.lock")).toThrow("Invalid git ref");
		});

		it("rejects names ending with '/' or '.'", () => {
			expect(() => validateGitRef("branch/")).toThrow("Invalid git ref");
			expect(() => validateGitRef("branch.")).toThrow("Invalid git ref");
		});

		it("rejects names with control characters", () => {
			expect(() => validateGitRef("branch\x00name")).toThrow(
				"contains invalid characters",
			);
		});

		it("rejects names with special git characters", () => {
			expect(() => validateGitRef("branch~1")).toThrow(
				"contains invalid characters",
			);
			expect(() => validateGitRef("branch^2")).toThrow(
				"contains invalid characters",
			);
			expect(() => validateGitRef("branch:ref")).toThrow(
				"contains invalid characters",
			);
			expect(() => validateGitRef("branch?")).toThrow(
				"contains invalid characters",
			);
			expect(() => validateGitRef("branch*")).toThrow(
				"contains invalid characters",
			);
			expect(() => validateGitRef("branch[0]")).toThrow(
				"contains invalid characters",
			);
			expect(() => validateGitRef("branch\\name")).toThrow(
				"contains invalid characters",
			);
		});
	});

	describe("getFileDiff", () => {
		it("parses added lines from diff output", async () => {
			const diffOutput = `diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,5 @@
 const a = 1;
+const b = 2;
+const c = 3;
 const d = 4;
`;
			execFileQueue.push({
				stdout: diffOutput,
				stderr: "",
			});

			const result = await getFileDiff("/home/user/project", "src/file.ts");

			expect(result.addedLines).toContain(2);
			expect(result.addedLines).toContain(3);
			expect(result.deletedLines).toEqual([]);
		});

		it("parses deleted lines from diff output", async () => {
			const diffOutput = `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,5 +1,3 @@
 const a = 1;
-const b = 2;
-const c = 3;
 const d = 4;
`;
			execFileQueue.push({
				stdout: diffOutput,
				stderr: "",
			});

			const result = await getFileDiff("/home/user/project", "src/file.ts");

			expect(result.deletedLines).toContain(2);
			expect(result.addedLines).toEqual([]);
		});

		it("parses deleted lines across multiple hunks", async () => {
			const diffOutput = `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,2 @@
 line1
-removed line
 line3
@@ -10,3 +9,2 @@
 line10
-another removed line
 line12
`;
			execFileQueue.push({
				stdout: diffOutput,
				stderr: "",
			});

			const result = await getFileDiff("/home/user/project", "src/file.ts");

			expect(result.deletedLines.length).toBeGreaterThan(0);
		});

		it("handles untracked files by marking all lines as added", async () => {
			execFileQueue.push(
				{ stdout: "", stderr: "" },
				{
					stdout: "?? src/new.ts",
					stderr: "",
				},
			);
			mockReadFile.mockResolvedValueOnce(
				"line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
			);

			const result = await getFileDiff("/home/user/project", "src/new.ts");

			expect(result.addedLines).toHaveLength(10);
			expect(result.addedLines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
			expect(result.deletedLines).toEqual([]);
		});

		it("returns empty arrays when file has no changes", async () => {
			execFileQueue.push(
				{ stdout: "", stderr: "" },
				{ stdout: "", stderr: "" },
			);

			const result = await getFileDiff(
				"/home/user/project",
				"src/unchanged.ts",
			);

			expect(result.addedLines).toEqual([]);
			expect(result.modifiedLines).toEqual([]);
			expect(result.deletedLines).toEqual([]);
		});

		it("returns empty arrays when git command fails", async () => {
			execFileQueue.push(new Error("Git error"));

			const result = await getFileDiff("/home/user/project", "src/file.ts");

			expect(result.addedLines).toEqual([]);
			expect(result.modifiedLines).toEqual([]);
			expect(result.deletedLines).toEqual([]);
		});

		it("handles multiple hunks in diff", async () => {
			const diffOutput = `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,2 +1,3 @@
 line1
+newline2
 line3
@@ -10,2 +11,3 @@
 line10
+newline11
 line12
`;
			execFileQueue.push({
				stdout: diffOutput,
				stderr: "",
			});

			const result = await getFileDiff("/home/user/project", "src/file.ts");

			expect(result.addedLines).toContain(2);
			expect(result.addedLines).toContain(12);
		});
	});
});
