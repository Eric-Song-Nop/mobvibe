import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildShellCommand, posixQuote, resolveShell } from "../shell.js";

describe("shell", () => {
	describe("resolveShell", () => {
		const origEnv = { ...process.env };

		beforeEach(() => {
			delete process.env.MOBVIBE_SHELL;
			delete process.env.SHELL;
		});

		afterEach(() => {
			process.env.MOBVIBE_SHELL = origEnv.MOBVIBE_SHELL;
			process.env.SHELL = origEnv.SHELL;
			// Clean up undefined keys
			if (origEnv.MOBVIBE_SHELL === undefined) delete process.env.MOBVIBE_SHELL;
			if (origEnv.SHELL === undefined) delete process.env.SHELL;
		});

		it("prefers MOBVIBE_SHELL when set", () => {
			process.env.MOBVIBE_SHELL = "/usr/local/bin/fish";
			process.env.SHELL = "/bin/bash";

			expect(resolveShell()).toBe("/usr/local/bin/fish");
		});

		it("falls back to SHELL when MOBVIBE_SHELL is not set", () => {
			process.env.SHELL = "/bin/zsh";

			expect(resolveShell()).toBe("/bin/zsh");
		});

		it("falls back to /bin/sh when no env vars are set", () => {
			expect(resolveShell()).toBe("/bin/sh");
		});
	});

	describe("posixQuote", () => {
		it("returns '' for empty string", () => {
			expect(posixQuote("")).toBe("''");
		});

		it("returns safe tokens unquoted", () => {
			expect(posixQuote("hello")).toBe("hello");
			expect(posixQuote("path/to/file.ts")).toBe("path/to/file.ts");
			expect(posixQuote("--flag=value")).toBe("--flag=value");
			expect(posixQuote("a-b_c:d")).toBe("a-b_c:d");
		});

		it("quotes strings with spaces", () => {
			expect(posixQuote("hello world")).toBe("'hello world'");
		});

		it("escapes single quotes", () => {
			expect(posixQuote("it's")).toBe("'it'\\''s'");
		});

		it("quotes strings with special shell characters", () => {
			expect(posixQuote("a && b")).toBe("'a && b'");
			expect(posixQuote("foo|bar")).toBe("'foo|bar'");
			expect(posixQuote("$HOME")).toBe("'$HOME'");
			expect(posixQuote("a;b")).toBe("'a;b'");
		});
	});

	describe("buildShellCommand", () => {
		it("passes command through when args is empty", () => {
			expect(buildShellCommand("ls -la && echo done", [])).toBe(
				"ls -la && echo done",
			);
		});

		it("appends safe args unquoted", () => {
			expect(buildShellCommand("git", ["status"])).toBe("git status");
		});

		it("quotes args with spaces", () => {
			expect(buildShellCommand("echo", ["hello world"])).toBe(
				"echo 'hello world'",
			);
		});

		it("quotes args with special characters", () => {
			expect(buildShellCommand("echo", ["it's", "a test"])).toBe(
				"echo 'it'\\''s' 'a test'",
			);
		});

		it("handles empty string arg", () => {
			expect(buildShellCommand("cmd", [""])).toBe("cmd ''");
		});
	});
});
