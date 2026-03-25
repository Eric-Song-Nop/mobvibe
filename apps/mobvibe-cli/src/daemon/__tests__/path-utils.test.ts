import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveWithinCwd } from "../path-utils.js";

const CWD = "/home/user/project";

describe("resolveWithinCwd", () => {
	describe("relative paths", () => {
		test("resolves simple relative path", () => {
			expect(resolveWithinCwd(CWD, "src/index.ts")).toBe(
				path.join(CWD, "src/index.ts"),
			);
		});

		test("resolves '.' to cwd itself", () => {
			expect(resolveWithinCwd(CWD, ".")).toBe(CWD);
		});

		test("allows '..' that stays within cwd", () => {
			expect(resolveWithinCwd(CWD, "src/../lib/utils.ts")).toBe(
				path.join(CWD, "lib/utils.ts"),
			);
		});
	});

	describe("absolute paths within cwd", () => {
		test("accepts path equal to cwd", () => {
			expect(resolveWithinCwd(CWD, CWD)).toBe(CWD);
		});

		test("accepts absolute child path", () => {
			const child = `${CWD}/src/main.ts`;
			expect(resolveWithinCwd(CWD, child)).toBe(child);
		});

		test("normalizes redundant separators", () => {
			expect(resolveWithinCwd(CWD, `${CWD}//src///index.ts`)).toBe(
				path.join(CWD, "src/index.ts"),
			);
		});
	});

	describe("windows paths", () => {
		const windowsCwd = "C:\\repo";

		test("accepts relative child path", () => {
			expect(resolveWithinCwd(windowsCwd, "src\\main.ts")).toBe(
				"C:\\repo\\src\\main.ts",
			);
		});

		test("accepts absolute child path with normalized separators", () => {
			expect(resolveWithinCwd(windowsCwd, "C:/repo/src/main.ts")).toBe(
				"C:\\repo\\src\\main.ts",
			);
		});

		test("accepts absolute child path with different drive-letter casing", () => {
			expect(resolveWithinCwd("c:\\repo", "C:\\repo\\src\\main.ts")).toBe(
				"C:\\repo\\src\\main.ts",
			);
		});

		test("rejects absolute child path with different directory casing", () => {
			expect(() =>
				resolveWithinCwd("c:\\repo", "C:\\Repo\\src\\main.ts"),
			).toThrow("Path escapes working directory");
		});

		test("rejects prefix spoof on windows", () => {
			expect(() =>
				resolveWithinCwd(windowsCwd, "C:\\repo-evil\\secret.txt"),
			).toThrow("Path escapes working directory");
		});

		test("rejects cross-drive path", () => {
			expect(() => resolveWithinCwd(windowsCwd, "D:\\other\\file.ts")).toThrow(
				"Path escapes working directory",
			);
		});

		test("rejects UNC path outside UNC cwd", () => {
			expect(() =>
				resolveWithinCwd(
					"\\\\server\\share\\repo",
					"\\\\server\\other-share\\repo\\file.ts",
				),
			).toThrow("Path escapes working directory");
		});
	});

	describe("escaping paths rejected", () => {
		test("rejects relative path escaping cwd", () => {
			expect(() => resolveWithinCwd(CWD, "../../etc/passwd")).toThrow(
				"Path escapes working directory",
			);
		});

		test("rejects absolute path outside cwd", () => {
			expect(() => resolveWithinCwd(CWD, "/etc/passwd")).toThrow(
				"Path escapes working directory",
			);
		});

		test("rejects prefix spoof (cwd as prefix but different dir)", () => {
			expect(() =>
				resolveWithinCwd(CWD, "/home/user/project-evil/secret"),
			).toThrow("Path escapes working directory");
		});
	});
});
