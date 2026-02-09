import { beforeEach, describe, expect, it, mock } from "bun:test";

// Mock child_process
const mockExecFileAsync = mock(() =>
	Promise.resolve({ stdout: "", stderr: "" }),
);
mock.module("node:util", () => ({
	promisify: () => mockExecFileAsync,
}));

// Mock fs/promises for readFile
const mockReadFile = mock(() => Promise.resolve(""));
const actualFsPromises = await import("node:fs/promises");
mock.module("node:fs/promises", () => ({
	...actualFsPromises,
	default: { ...actualFsPromises, readFile: mockReadFile },
	readFile: mockReadFile,
}));

// Import after mocking
const {
	isGitRepo,
	getGitBranch,
	getGitStatus,
	getFileDiff,
	aggregateDirStatus,
} = await import("../git-utils.js");

describe("git-utils", () => {
	beforeEach(() => {
		mockExecFileAsync.mockReset();
		mockReadFile.mockReset();
	});

	describe("isGitRepo", () => {
		it("returns true when directory is a git repo", async () => {
			mockExecFileAsync.mockResolvedValueOnce({ stdout: "true\n", stderr: "" });

			const result = await isGitRepo("/home/user/project");

			expect(result).toBe(true);
			expect(mockExecFileAsync).toHaveBeenCalledWith(
				"git",
				["rev-parse", "--is-inside-work-tree"],
				expect.objectContaining({ cwd: "/home/user/project" }),
			);
		});

		it("returns false when directory is not a git repo", async () => {
			mockExecFileAsync.mockRejectedValueOnce(
				new Error("Not a git repository"),
			);

			const result = await isGitRepo("/home/user/not-a-repo");

			expect(result).toBe(false);
		});
	});

	describe("getGitBranch", () => {
		it("returns branch name when on a branch", async () => {
			mockExecFileAsync.mockResolvedValueOnce({ stdout: "main\n", stderr: "" });

			const result = await getGitBranch("/home/user/project");

			expect(result).toBe("main");
			expect(mockExecFileAsync).toHaveBeenCalledWith(
				"git",
				["branch", "--show-current"],
				expect.objectContaining({ cwd: "/home/user/project" }),
			);
		});

		it("returns short commit hash when in detached HEAD state", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "\n", stderr: "" }) // branch --show-current returns empty
				.mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }); // rev-parse --short HEAD

			const result = await getGitBranch("/home/user/project");

			expect(result).toBe("abc1234");
		});

		it("returns undefined when git command fails", async () => {
			mockExecFileAsync.mockRejectedValueOnce(new Error("Git error"));

			const result = await getGitBranch("/home/user/project");

			expect(result).toBeUndefined();
		});
	});

	describe("getGitStatus", () => {
		it("parses modified files correctly", async () => {
			mockExecFileAsync.mockResolvedValueOnce({
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
			mockExecFileAsync.mockResolvedValueOnce({
				stdout: "A  src/new-file.ts\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([{ path: "src/new-file.ts", status: "A" }]);
		});

		it("parses deleted files correctly", async () => {
			mockExecFileAsync.mockResolvedValueOnce({
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
			mockExecFileAsync.mockResolvedValueOnce({
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
			mockExecFileAsync.mockResolvedValueOnce({
				stdout: "R  old-name.ts -> new-name.ts\n",
				stderr: "",
			});

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([{ path: "new-name.ts", status: "R" }]);
		});

		it("returns empty array when git command fails", async () => {
			mockExecFileAsync.mockRejectedValueOnce(new Error("Git error"));

			const result = await getGitStatus("/home/user/project");

			expect(result).toEqual([]);
		});

		it("handles mixed status output", async () => {
			mockExecFileAsync.mockResolvedValueOnce({
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
				src: "A", // A has higher priority than M
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

			// Priority: A > D > M > R > C > U > ? > !
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
			mockExecFileAsync.mockResolvedValueOnce({
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
			mockExecFileAsync.mockResolvedValueOnce({
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
			mockExecFileAsync.mockResolvedValueOnce({
				stdout: diffOutput,
				stderr: "",
			});

			const result = await getFileDiff("/home/user/project", "src/file.ts");

			expect(result.deletedLines.length).toBeGreaterThan(0);
		});

		it("handles untracked files by marking all lines as added", async () => {
			// First call: git diff HEAD returns empty (no diff)
			mockExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
			// Second call: git status shows untracked
			mockExecFileAsync.mockResolvedValueOnce({
				stdout: "?? src/new.ts",
				stderr: "",
			});
			// readFile returns file content with 10 lines
			mockReadFile.mockResolvedValueOnce(
				"line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
			);

			const result = await getFileDiff("/home/user/project", "src/new.ts");

			expect(result.addedLines).toHaveLength(10);
			expect(result.addedLines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
			expect(result.deletedLines).toEqual([]);
		});

		it("returns empty arrays when file has no changes", async () => {
			// First call: git diff HEAD returns empty
			mockExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
			// Second call: git status shows no changes
			mockExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });

			const result = await getFileDiff(
				"/home/user/project",
				"src/unchanged.ts",
			);

			expect(result.addedLines).toEqual([]);
			expect(result.modifiedLines).toEqual([]);
			expect(result.deletedLines).toEqual([]);
		});

		it("returns empty arrays when git command fails", async () => {
			mockExecFileAsync.mockRejectedValueOnce(new Error("Git error"));

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
			mockExecFileAsync.mockResolvedValueOnce({
				stdout: diffOutput,
				stderr: "",
			});

			const result = await getFileDiff("/home/user/project", "src/file.ts");

			expect(result.addedLines).toContain(2);
			expect(result.addedLines).toContain(12);
		});
	});
});
