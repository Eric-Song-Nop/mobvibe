import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { syncDocumentLanguage } from "@/i18n";

describe("document language", () => {
	afterEach(async () => {
		await i18n.changeLanguage("en");
	});

	it("tracks the active i18n language", async () => {
		document.documentElement.lang = "en";

		await i18n.changeLanguage("zh-CN");

		expect(document.documentElement.lang).toBe("zh");
	});

	it("is safe when rendered without a document", () => {
		vi.stubGlobal("document", undefined);

		try {
			expect(() => syncDocumentLanguage("zh")).not.toThrow();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
