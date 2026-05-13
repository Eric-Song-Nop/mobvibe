import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedDiffView } from "../DiffView";

const mocks = vi.hoisted(() => ({
	fileDiff: vi.fn(
		({ fileDiff, options, className }: Record<string, unknown>) => (
			<div
				className={className as string | undefined}
				data-file-name={(fileDiff as { name: string }).name}
				data-options={JSON.stringify(options)}
				data-testid="file-diff"
			/>
		),
	),
	multiFileDiff: vi.fn(
		({ oldFile, newFile, options }: Record<string, unknown>) => (
			<div
				data-new-name={(newFile as { name: string }).name}
				data-old-name={(oldFile as { name: string }).name}
				data-options={JSON.stringify(options)}
				data-testid="multi-file-diff"
			/>
		),
	),
	parsePatchFiles: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({
	parsePatchFiles: mocks.parsePatchFiles,
}));

vi.mock("@pierre/diffs/react", () => ({
	FileDiff: mocks.fileDiff,
	MultiFileDiff: mocks.multiFileDiff,
}));

type DiffFileProps = {
	name: string;
	contents: string;
	cacheKey: string;
};

type MultiFileDiffProps = {
	oldFile: DiffFileProps;
	newFile: DiffFileProps;
	options: unknown;
};

const getLastMultiFileDiffProps = () => {
	const lastCall = mocks.multiFileDiff.mock.calls.at(-1);

	if (!lastCall) {
		throw new Error("Expected MultiFileDiff to have been called");
	}

	return lastCall[0] as MultiFileDiffProps;
};

const diffOptions = {
	theme: {
		light: "gruvbox-light-medium",
		dark: "gruvbox-dark-medium",
	},
	themeType: "light",
	diffStyle: "unified",
	diffIndicators: "bars",
	lineDiffType: "word-alt",
	disableBackground: false,
	overflow: "wrap",
	disableLineNumbers: false,
};

describe("UnifiedDiffView", () => {
	beforeEach(() => {
		document.documentElement.className = "";
		mocks.fileDiff.mockClear();
		mocks.multiFileDiff.mockClear();
		mocks.parsePatchFiles.mockReset();
		mocks.parsePatchFiles.mockReturnValue([
			{
				files: [
					{
						name: "b/src/demo.ts",
						type: "change",
						hunks: [],
						splitLineCount: 0,
						unifiedLineCount: 0,
						isPartial: true,
						deletionLines: [],
						additionLines: [],
					},
				],
			},
		]);
	});

	it("renders raw git diff files through FileDiff with shared Pierre options", () => {
		render(
			<UnifiedDiffView
				diff="diff --git a/src/demo.ts b/src/demo.ts"
				path="src/demo.ts"
				getLabel={(key) => key}
			/>,
		);

		expect(screen.getByText("toolCall.changes")).toBeInTheDocument();
		expect(screen.getByText("demo.ts")).toBeInTheDocument();
		expect(screen.getByTestId("file-diff")).toHaveAttribute(
			"data-file-name",
			"src/demo.ts",
		);
		expect(mocks.fileDiff).toHaveBeenCalledWith(
			expect.objectContaining({
				options: diffOptions,
			}),
			undefined,
		);
	});

	it("renders old and new file content through MultiFileDiff", () => {
		render(
			<UnifiedDiffView
				oldText="const value = 1;"
				newText="const value = 2;"
				path="src/demo.ts"
				getLabel={(key) => key}
			/>,
		);

		expect(screen.getByTestId("multi-file-diff")).toHaveAttribute(
			"data-new-name",
			"src/demo.ts",
		);
		expect(mocks.multiFileDiff).toHaveBeenCalledWith(
			expect.objectContaining({
				options: diffOptions,
				oldFile: expect.objectContaining({ contents: "const value = 1;" }),
				newFile: expect.objectContaining({ contents: "const value = 2;" }),
			}),
			undefined,
		);
	});

	it("changes content cache keys when same-path file contents change", () => {
		const path = "src/demo.ts";
		const { rerender } = render(
			<UnifiedDiffView
				oldText="old v1"
				newText="new v1"
				path={path}
				getLabel={(key) => key}
			/>,
		);
		const initialProps = getLastMultiFileDiffProps();
		const initialOldCacheKey = initialProps.oldFile.cacheKey;
		const initialNewCacheKey = initialProps.newFile.cacheKey;

		expect(initialOldCacheKey).toMatch(
			/^file:11:src\/demo\.ts:6:[0-9a-f]{16}$/,
		);
		expect(initialNewCacheKey).toMatch(
			/^file:11:src\/demo\.ts:6:[0-9a-f]{16}$/,
		);

		rerender(
			<UnifiedDiffView
				oldText="old v2"
				newText="new v1"
				path={path}
				getLabel={(key) => key}
			/>,
		);
		const oldContentChangedProps = getLastMultiFileDiffProps();

		expect(oldContentChangedProps.oldFile.cacheKey).not.toBe(
			initialOldCacheKey,
		);
		expect(oldContentChangedProps.newFile.cacheKey).toBe(initialNewCacheKey);

		rerender(
			<UnifiedDiffView
				oldText="old v2"
				newText="new v2"
				path={path}
				getLabel={(key) => key}
			/>,
		);
		const newContentChangedProps = getLastMultiFileDiffProps();

		expect(newContentChangedProps.oldFile.cacheKey).toBe(
			oldContentChangedProps.oldFile.cacheKey,
		);
		expect(newContentChangedProps.newFile.cacheKey).not.toBe(
			initialNewCacheKey,
		);
	});

	it("does not render when old and new content match", () => {
		const { container } = render(
			<UnifiedDiffView
				oldText="same"
				newText="same"
				path="src/demo.ts"
				getLabel={(key) => key}
			/>,
		);

		expect(container).toBeEmptyDOMElement();
		expect(mocks.multiFileDiff).not.toHaveBeenCalled();
	});

	it("uses dark Gruvbox mode from the document root", async () => {
		document.documentElement.classList.add("dark");

		render(
			<UnifiedDiffView
				oldText="old"
				newText="new"
				path="src/demo.ts"
				getLabel={(key) => key}
			/>,
		);

		await waitFor(() => {
			expect(mocks.multiFileDiff).toHaveBeenLastCalledWith(
				expect.objectContaining({
					options: expect.objectContaining({ themeType: "dark" }),
				}),
				undefined,
			);
		});
	});

	it("keeps full height diff panels scrollable", () => {
		render(
			<UnifiedDiffView
				diff="diff --git a/src/demo.ts b/src/demo.ts"
				path="src/demo.ts"
				getLabel={(key) => key}
				fullHeight
			/>,
		);

		const panel = screen.getByTestId("file-diff").parentElement;
		expect(panel).toHaveClass("min-h-0");
		expect(panel).toHaveClass("flex-1");
		expect(panel).toHaveClass("overflow-auto");
	});
});
