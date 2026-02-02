import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { SessionFsFilePreviewResponse } from "@/lib/api";
import { fetchSessionGitDiff } from "@/lib/api";
import { CodePreview } from "../CodePreview";

vi.mock("@/lib/api", () => ({
	fetchSessionGitDiff: vi.fn(),
}));

const createTestQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

const TestWrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={createTestQueryClient()}>
		{children}
	</QueryClientProvider>
);

type TreeSitterTestFlag = { __ENABLE_TREESITTER_TESTS__?: boolean };

type OutlineKind = "class" | "method" | "function";

type TestNode = {
	startIndex: number;
	endIndex: number;
	startPosition: { row: number; column: number };
	endPosition: { row: number; column: number };
	text: string;
};

type TestQueryCapture = { name: string; node: TestNode };

type TestQueryMatch = { captures: TestQueryCapture[] };

type OutlineMatch = {
	kind: OutlineKind;
	label: string;
	startIndex: number;
	endIndex: number;
	row: number;
	endRow?: number;
};

const queryMatches = vi.hoisted(() => [] as TestQueryMatch[]);
const parsedCode = vi.hoisted(() => ({ current: "" }));
const mockOutlineLanguage = vi.hoisted(() => ({ id: "mock-language" }));
const originalWebAssembly = globalThis.WebAssembly;
const originalFetch = globalThis.fetch;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

vi.mock("web-tree-sitter", () => {
	class MockParser {
		setLanguage() {
			return this;
		}
		parse(code: string) {
			parsedCode.current = code;
			return {
				rootNode: {} as TestNode,
				delete: vi.fn(),
			};
		}
		static init() {
			return Promise.resolve();
		}
	}
	return {
		Parser: MockParser,
		Language: {
			load: vi.fn(async () => mockOutlineLanguage),
		},
		Query: class {
			matches() {
				return queryMatches;
			}
		},
	};
});

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: { children: React.ReactNode }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

const setTreeSitterSupport = (enabled: boolean) => {
	if (!enabled) {
		Object.defineProperty(globalThis, "WebAssembly", {
			value: undefined,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(globalThis, "fetch", {
			value: undefined,
			writable: true,
			configurable: true,
		});
		return;
	}
	Object.defineProperty(globalThis, "WebAssembly", {
		value: { compile: () => {} },
		writable: true,
		configurable: true,
	});
	Object.defineProperty(globalThis, "fetch", {
		value: vi.fn(),
		writable: true,
		configurable: true,
	});
};

const setTreeSitterTestFlag = (enabled: boolean) => {
	const target = globalThis as typeof globalThis & TreeSitterTestFlag;
	if (enabled) {
		target.__ENABLE_TREESITTER_TESTS__ = true;
		return;
	}
	delete target.__ENABLE_TREESITTER_TESTS__;
};

const restoreTreeSitterSupport = () => {
	Object.defineProperty(globalThis, "WebAssembly", {
		value: originalWebAssembly,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(globalThis, "fetch", {
		value: originalFetch,
		writable: true,
		configurable: true,
	});
	setTreeSitterTestFlag(false);
};

const buildNode = (
	text: string,
	startIndex: number,
	endIndex: number,
	row: number,
	endRow?: number,
): TestNode => ({
	startIndex,
	endIndex,
	startPosition: { row, column: 0 },
	endPosition: { row: endRow ?? row, column: 0 },
	text,
});

const buildMatch = ({
	kind,
	label,
	startIndex,
	endIndex,
	row,
	endRow,
}: OutlineMatch): TestQueryMatch => ({
	captures: [
		{
			name: `definition.${kind}`,
			node: buildNode("", startIndex, endIndex, row, endRow),
		},
		{
			name: "name",
			node: buildNode(label, startIndex, endIndex, row, endRow),
		},
	],
});

const buildPayload = (
	overrides: Partial<SessionFsFilePreviewResponse> = {},
): SessionFsFilePreviewResponse => ({
	path: "/tmp/example.ts",
	previewType: "code",
	content: "const a = 1\nconst b = 2",
	...overrides,
});

beforeEach(() => {
	queryMatches.length = 0;
	parsedCode.current = "";
	setTreeSitterSupport(false);
	setTreeSitterTestFlag(false);
});

afterEach(() => {
	restoreTreeSitterSupport();
	vi.clearAllMocks();
});

describe("CodePreview", () => {
	it("renders language badge and line count", () => {
		render(<CodePreview payload={buildPayload()} />, { wrapper: TestWrapper });

		expect(screen.getByText("typescript")).toBeInTheDocument();
		expect(
			screen.getByText(i18n.t("codePreview.lineCount", { count: 2 })),
		).toBeInTheDocument();
	});

	it("renders at least one line for empty content", () => {
		render(<CodePreview payload={buildPayload({ content: "" })} />, {
			wrapper: TestWrapper,
		});

		expect(
			screen.getByText(i18n.t("codePreview.lineCount", { count: 1 })),
		).toBeInTheDocument();
	});

	it("hides outline when tree-sitter unsupported", async () => {
		setTreeSitterSupport(false);
		render(<CodePreview payload={buildPayload()} />, { wrapper: TestWrapper });

		expect(
			screen.queryByRole("button", {
				name: i18n.t("codePreview.outline"),
			}),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(i18n.t("codePreview.outlineUnsupported")),
		).not.toBeInTheDocument();
	});

	it("renders outline items and jumps to line", async () => {
		setTreeSitterSupport(true);
		setTreeSitterTestFlag(true);
		queryMatches.push(
			buildMatch({
				kind: "class",
				label: "Alpha",
				startIndex: 0,
				endIndex: 120,
				row: 0,
			}),
			buildMatch({
				kind: "method",
				label: "run",
				startIndex: 14,
				endIndex: 24,
				row: 1,
			}),
			buildMatch({
				kind: "function",
				label: "beta",
				startIndex: 160,
				endIndex: 200,
				row: 4,
			}),
		);

		render(
			<CodePreview
				payload={buildPayload({
					content: "class Alpha {\n  run() {}\n}\n\nfunction beta() {}",
				})}
			/>,
			{ wrapper: TestWrapper },
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
		});

		expect(screen.getByRole("button", { name: "run" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "beta" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Method · Tap to copy" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Function · Tap to copy" }),
		).toBeInTheDocument();
		expect(parsedCode.current).toContain("class Alpha");

		const lineElement = document.querySelector(
			"[data-line='2']",
		) as HTMLElement | null;
		expect(lineElement).not.toBeNull();

		const scrollSpy = vi.fn();
		if (lineElement) {
			lineElement.scrollIntoView = scrollSpy;
		}

		const user = userEvent.setup();
		const rafDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"requestAnimationFrame",
		);
		Object.defineProperty(window, "requestAnimationFrame", {
			value: (callback: FrameRequestCallback) => {
				callback(0);
				return 0;
			},
			configurable: true,
		});

		await user.click(screen.getByRole("button", { name: "run" }));
		expect(scrollSpy).toHaveBeenCalled();

		if (rafDescriptor) {
			Object.defineProperty(window, "requestAnimationFrame", rafDescriptor);
		} else {
			Object.defineProperty(window, "requestAnimationFrame", {
				value: originalRequestAnimationFrame,
				configurable: true,
			});
		}

		const writeSpy = vi.fn();
		const clipboardDescriptor = Object.getOwnPropertyDescriptor(
			navigator,
			"clipboard",
		);
		Object.defineProperty(navigator, "clipboard", {
			value: {
				writeText: writeSpy,
			},
			configurable: true,
		});

		await user.click(
			screen.getByRole("button", { name: "Method · Tap to copy" }),
		);
		expect(writeSpy).toHaveBeenCalledWith("  run() {}");

		if (clipboardDescriptor) {
			Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
		} else {
			Object.defineProperty(navigator, "clipboard", {
				value: undefined,
				configurable: true,
			});
		}
	});

	it("renders git status indicators for symbols with changes", async () => {
		setTreeSitterSupport(true);
		setTreeSitterTestFlag(true);

		// Mock outline items spanning different line ranges
		queryMatches.push(
			buildMatch({
				kind: "function",
				label: "addedFunc",
				startIndex: 0,
				endIndex: 50,
				row: 0,
				endRow: 2, // Lines 1-3
			}),
			buildMatch({
				kind: "function",
				label: "deletedFunc",
				startIndex: 60,
				endIndex: 100,
				row: 4,
				endRow: 6, // Lines 5-7
			}),
			buildMatch({
				kind: "function",
				label: "modifiedFunc",
				startIndex: 110,
				endIndex: 150,
				row: 8,
				endRow: 10, // Lines 9-11
			}),
		);

		// Mock the git diff API
		vi.mocked(fetchSessionGitDiff).mockResolvedValueOnce({
			isGitRepo: true,
			path: "/tmp/example.ts",
			addedLines: [2], // Affects addedFunc (lines 1-3)
			deletedLines: [6], // Affects deletedFunc (lines 5-7)
			modifiedLines: [10], // Affects modifiedFunc (lines 9-11)
		});

		const multiLineContent = `function addedFunc() {
  console.log("added");
}

function deletedFunc() {
  console.log("deleted");
}

function modifiedFunc() {
  console.log("modified");
}`;

		render(
			<CodePreview
				payload={buildPayload({
					content: multiLineContent,
				})}
				sessionId="test-session"
			/>,
			{ wrapper: TestWrapper },
		);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "addedFunc" }),
			).toBeInTheDocument();
		});

		// Verify all outline items are rendered
		expect(
			screen.getByRole("button", { name: "deletedFunc" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "modifiedFunc" }),
		).toBeInTheDocument();

		// Check for git indicators
		const addedIndicator = document.querySelector(
			".file-preview-outline__git-indicator--added",
		);
		const deletedIndicator = document.querySelector(
			".file-preview-outline__git-indicator--deleted",
		);
		const modifiedIndicator = document.querySelector(
			".file-preview-outline__git-indicator--modified",
		);

		expect(addedIndicator?.textContent).toBe("+");
		expect(deletedIndicator?.textContent).toBe("-");
		expect(modifiedIndicator?.textContent).toBe("m");
	});
});
