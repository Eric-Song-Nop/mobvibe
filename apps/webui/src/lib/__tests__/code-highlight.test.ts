import { describe, expect, it } from "vitest";
import { resolvePrismLanguage } from "../code-highlight";

describe("code-highlight", () => {
	describe("resolvePrismLanguage", () => {
		it("keeps supported languages", () => {
			expect(resolvePrismLanguage("typescript")).toBe("typescript");
			expect(resolvePrismLanguage("tsx")).toBe("tsx");
			expect(resolvePrismLanguage("markdown")).toBe("markdown");
		});

		it("maps unsupported languages to supported prism grammars", () => {
			expect(["csharp", "clike", "c"]).toContain(
				resolvePrismLanguage("csharp"),
			);
			expect(["scss", "css"]).toContain(resolvePrismLanguage("scss"));
			expect(["mdx", "jsx", "markdown"]).toContain(resolvePrismLanguage("mdx"));
		});

		it("falls back to text for unknown input", () => {
			expect(resolvePrismLanguage("not-a-real-language")).toBe("text");
		});
	});
});
