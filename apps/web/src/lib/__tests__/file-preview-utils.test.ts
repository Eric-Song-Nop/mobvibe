import { describe, expect, it } from "vitest";
import {
	resolveFileNameFromPath,
	resolveLanguageFromPath,
} from "../file-preview-utils";

describe("file-preview-utils", () => {
	describe("resolveLanguageFromPath", () => {
		it("returns mapped language for known extensions", () => {
			expect(resolveLanguageFromPath("/tmp/file.ts")).toBe("typescript");
			expect(resolveLanguageFromPath("main.TSX")).toBe("tsx");
			expect(resolveLanguageFromPath("notes.md")).toBe("markdown");
			expect(resolveLanguageFromPath("script.jsx")).toBe("jsx");
		});

		it("falls back to text for unknown or missing extensions", () => {
			expect(resolveLanguageFromPath("/tmp/file.unknown")).toBe("text");
			expect(resolveLanguageFromPath("README")).toBe("text");
		});
	});

	describe("resolveFileNameFromPath", () => {
		it("returns undefined for empty input", () => {
			expect(resolveFileNameFromPath()).toBeUndefined();
			expect(resolveFileNameFromPath("")).toBeUndefined();
		});

		it("returns filename for unix or windows paths", () => {
			expect(resolveFileNameFromPath("/tmp/demo.txt")).toBe("demo.txt");
			expect(resolveFileNameFromPath("C:\\path\\to\\demo.txt")).toBe(
				"demo.txt",
			);
		});

		it("returns original value when no separators exist", () => {
			expect(resolveFileNameFromPath("demo.txt")).toBe("demo.txt");
		});
	});
});
