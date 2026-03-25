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
	getGitBranch,
	getGitBranches,
	getGitStatus,
	getFileDiff,
	aggregateDirStatus,
	validateGitRef,
} = await import("../git-utils.js");

describe("git-utils", () => {
	beforeEach(() => {
		mockExecFileAsync.mockClear();
		execFileQueue.length = 0;
		mockReadFile.mockClear();
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

	describe("getGitBranches", () => {
		it("keeps the real branch name separate from upstream and tracking info", async () => {
			execFileQueue.push({
				stdout: [
					"refs/heads/main\tmain\t*\torigin/main\t[ahead 2, behind 1]",
					"refs/heads/feature/worktree-fix\tfeature/worktree-fix\t\torigin/feature/worktree-fix\t",
					"refs/remotes/origin/main\torigin/main\t\t\t",
				].join("\n"),
				stderr: "",
			});

			const result = await getGitBranches("/home/user/project");

			expect(result).toEqual([
				{
					name: "main",
					displayName: "main (HEAD)",
					current: true,
					remote: undefined,
					upstream: "origin/main",
					aheadBehind: { ahead: 2, behind: 1 },
				},
				{
					name: "feature/worktree-fix",
					displayName: "feature/worktree-fix",
					current: false,
					remote: undefined,
					upstream: "origin/feature/worktree-fix",
					aheadBehind: undefined,
				},
				{
					name: "origin/main",
					displayName: "origin/main",
					current: false,
					remote: "origin",
					upstream: undefined,
					aheadBehind: undefined,
				},
			]);
			expect(mockExecFileAsync).toHaveBeenCalledWith(
				"git",
				[
					"branch",
					"-a",
					"--format=%(refname)\t%(refname:short)\t%(HEAD)\t%(upstream:short)\t%(upstream:track)",
				],
				expect.objectContaining({ cwd: "/home/user/project" }),
			);
		});

		it("accepts git output that contains literal %x09 separators", async () => {
			execFileQueue.push({
				stdout: [
					"refs/heads/main%x09main%x09*%x09origin/main%x09[ahead 1]",
					"refs/remotes/origin/main%x09origin/main%x09%x09%x09",
				].join("\n"),
				stderr: "",
			});

			const result = await getGitBranches("/home/user/project");

			expect(result).toEqual([
				{
					name: "main",
					displayName: "main (HEAD)",
					current: true,
					remote: undefined,
					upstream: "origin/main",
					aheadBehind: { ahead: 1, behind: 0 },
				},
				{
					name: "origin/main",
					displayName: "origin/main",
					current: false,
					remote: "origin",
					upstream: undefined,
					aheadBehind: undefined,
				},
			]);
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
