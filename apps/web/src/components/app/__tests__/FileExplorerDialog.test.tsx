import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { FsEntry, SessionFsFilePreviewResponse } from "@/lib/api";
import * as api from "@/lib/api";
import { FileExplorerDialog } from "../FileExplorerDialog";

vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogCancel: ({
		children,
		...props
	}: {
		children: React.ReactNode;
	}) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

vi.mock("@/components/app/file-preview-renderers", () => ({
	previewRenderers: {
		code: () => <div data-testid="code-preview" />,
		image: () => <div data-testid="image-preview" />,
	},
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: { children: React.ReactNode }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

vi.mock("@/components/app/ColumnFileBrowser", () => {
	const fileEntry: FsEntry = {
		name: "notes.md",
		path: "/workspace/notes.md",
		type: "file",
		hidden: false,
	};

	return {
		ColumnFileBrowser: ({
			onEntrySelect,
		}: {
			onEntrySelect: (entry: FsEntry, columnIndex: number) => void;
		}) => (
			<button type="button" onClick={() => onEntrySelect(fileEntry, 0)}>
				Select file
			</button>
		),
		useColumnFileBrowser: ({
			onFileSelect,
		}: {
			onFileSelect?: (entry: FsEntry) => void;
		}) => ({
			columns: [],
			isLoading: false,
			pathError: undefined,
			handleEntrySelect: async (entry: FsEntry) => {
				onFileSelect?.(entry);
			},
			handleColumnSelect: () => {},
			scrollContainerRef: { current: null },
			columnRefs: { current: {} },
		}),
	};
});

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		fetchSessionFsRoots: vi.fn(),
		fetchSessionFsEntries: vi.fn(),
		fetchSessionFsFile: vi.fn(),
	};
});

describe("FileExplorerDialog", () => {
	let queryClient: QueryClient;

	const renderDialog = () =>
		render(
			<QueryClientProvider client={queryClient}>
				<FileExplorerDialog
					open={true}
					onOpenChange={() => {}}
					sessionId="session-1"
				/>
			</QueryClientProvider>,
		);

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
		vi.clearAllMocks();
		vi.mocked(api.fetchSessionFsRoots).mockResolvedValue({
			root: {
				name: i18n.t("session.cwdLabel"),
				path: "/workspace",
			},
		});
		vi.mocked(api.fetchSessionFsEntries).mockResolvedValue({
			path: "/workspace",
			entries: [],
		});
		const previewResponse: SessionFsFilePreviewResponse = {
			path: "/workspace/notes.md",
			previewType: "code",
			content: "hello",
		};
		vi.mocked(api.fetchSessionFsFile).mockResolvedValue(previewResponse);
	});

	it("shows fallback title when no file selected", () => {
		renderDialog();

		expect(
			screen.getByText(i18n.t("fileExplorer.preview"), { selector: "div" }),
		).toBeInTheDocument();
	});

	it("renders file name after selecting a file", async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click(screen.getByRole("button", { name: "Select file" }));

		expect(screen.getByText("notes.md")).toBeInTheDocument();
		expect(
			screen.queryByText(i18n.t("fileExplorer.preview"), { selector: "div" }),
		).not.toBeInTheDocument();
	});
});
