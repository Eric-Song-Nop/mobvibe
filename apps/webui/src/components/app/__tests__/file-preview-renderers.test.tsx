import { describe, expect, it } from "vitest";
import { previewRenderers } from "../file-preview-renderers";

describe("file-preview-renderers", () => {
	it("registers code and image renderers", () => {
		expect(previewRenderers.code).toBeDefined();
		expect(previewRenderers.image).toBeDefined();
	});
});
