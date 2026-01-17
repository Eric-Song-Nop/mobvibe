import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionFsFilePreviewResponse } from "@/lib/api";
import { CodePreview } from "../CodePreview";

const buildPayload = (
	overrides: Partial<SessionFsFilePreviewResponse> = {},
): SessionFsFilePreviewResponse => ({
	path: "/tmp/example.ts",
	previewType: "code",
	content: "const a = 1\nconst b = 2",
	...overrides,
});

describe("CodePreview", () => {
	it("renders language badge and line count", () => {
		render(<CodePreview payload={buildPayload()} />);

		expect(screen.getByText("typescript")).toBeInTheDocument();
		expect(screen.getByText("2 行")).toBeInTheDocument();
	});

	it("renders at least one line for empty content", () => {
		render(<CodePreview payload={buildPayload({ content: "" })} />);

		expect(screen.getByText("1 行")).toBeInTheDocument();
	});
});
