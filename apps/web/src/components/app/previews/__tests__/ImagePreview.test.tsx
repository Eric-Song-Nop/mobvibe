import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionFsFilePreviewResponse } from "@/lib/api";
import { ImagePreview } from "../ImagePreview";

describe("ImagePreview", () => {
	it("renders image with src and alt", () => {
		const payload: SessionFsFilePreviewResponse = {
			path: "/tmp/sample.png",
			previewType: "image",
			content: "data:image/png;base64,abc",
		};

		render(<ImagePreview payload={payload} />);

		const image = screen.getByRole("img");
		expect(image).toHaveAttribute("src", payload.content);
		expect(image).toHaveAttribute("alt", payload.path);
	});
});
