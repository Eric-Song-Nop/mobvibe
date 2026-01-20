import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { SessionFsFilePreviewResponse } from "@/lib/api";
import { CodePreview } from "../CodePreview";

type TreeSitterTestFlag = { __ENABLE_TREESITTER_TESTS__?: boolean };

type OutlineKind = "class" | "method" | "function";

type TestNode = {
	startIndex: number;
	endIndex: number;
	startPosition: { row: number; column: number };
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
};

const queryMatches = vi.hoisted(() => [] as TestQueryMatch[]);
const parsedCode = vi.hoisted(() => ({ current: "" }));
const mockOutlineLanguage = vi.hoisted(() => ({ id: "mock-language" }));
const originalWebAssembly = globalThis.WebAssembly;
const originalFetch = globalThis.fetch;

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
): TestNode => ({
	startIndex,
	endIndex,
	startPosition: { row, column: 0 },
	text,
});

const buildMatch = ({
	kind,
	label,
	startIndex,
	endIndex,
	row,
}: OutlineMatch): TestQueryMatch => ({
	captures: [
		{
			name: `definition.${kind}`,
			node: buildNode("", startIndex, endIndex, row),
		},
		{
			name: "name",
			node: buildNode(label, startIndex, endIndex, row),
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
		render(<CodePreview payload={buildPayload()} />);

		expect(screen.getByText("typescript")).toBeInTheDocument();
		expect(
			screen.getByText(i18n.t("codePreview.lineCount", { count: 2 })),
		).toBeInTheDocument();
	});

	it("renders at least one line for empty content", () => {
		render(<CodePreview payload={buildPayload({ content: "" })} />);

		expect(
			screen.getByText(i18n.t("codePreview.lineCount", { count: 1 })),
		).toBeInTheDocument();
	});

	it("hides outline when tree-sitter unsupported", async () => {
		setTreeSitterSupport(false);
		render(<CodePreview payload={buildPayload()} />);

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
				startIndex: 12,
				endIndex: 40,
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
		);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Alpha · Class" }),
			).toBeInTheDocument();
		});

		expect(
			screen.getByRole("button", { name: "run · Method" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "beta · Function" }),
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
		await user.click(screen.getByRole("button", { name: "run · Method" }));
		expect(scrollSpy).toHaveBeenCalled();
	});
});
