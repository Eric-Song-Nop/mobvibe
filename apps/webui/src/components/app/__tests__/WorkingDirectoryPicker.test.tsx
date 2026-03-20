import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkingDirectoryPicker } from "../WorkingDirectoryPicker";

type FsEntry = {
	name: string;
	path: string;
	type: "directory" | "file";
	hidden: boolean;
};

type FsEntriesResponse = {
	path: string;
	entries: FsEntry[];
};

const apiMocks = vi.hoisted(() => ({
	fetchFsRoots: vi.fn(),
	fetchFsEntries: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	initReactI18next: { type: "3rdParty", init: () => {} },
	useTranslation: () => ({
		t: (key: string, options?: Record<string, string>) => {
			const translations: Record<string, string> = {
				"session.cwdLabel": "Working directory",
				"session.cwdPlaceholder": "Enter a path",
				"errors.selectMachine": "Select a machine",
				"errors.pathLoadFailed": "Failed to load path",
				"workingDirectory.homeLabel": options?.defaultValue ?? "Home",
				"workingDirectory.emptyDirectory": "No subdirectories",
			};
			return translations[key] ?? key;
		},
	}),
}));

vi.mock("@/components/app/ColumnFileBrowser", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/components/app/ColumnFileBrowser")>();
	return {
		...actual,
		ColumnFileBrowser: ({
			columns,
		}: {
			columns: Array<{ name: string; path: string }>;
		}) => (
			<div data-testid="columns">
				{columns.map((column) => (
					<div key={column.path}>{column.path}</div>
				))}
			</div>
		),
	};
});

vi.mock("@/lib/api", () => apiMocks);

const directoryEntries = new Map<string, FsEntry[]>([
	[
		"C:\\Users\\eric",
		[
			{
				name: "projects",
				path: "C:\\Users\\eric\\projects",
				type: "directory",
				hidden: false,
			},
		],
	],
	[
		"C:\\",
		[
			{
				name: "Users",
				path: "C:\\Users",
				type: "directory",
				hidden: false,
			},
		],
	],
	[
		"D:\\",
		[
			{
				name: "repo",
				path: "D:\\repo",
				type: "directory",
				hidden: false,
			},
		],
	],
	[
		"D:\\repo",
		[
			{
				name: "src",
				path: "D:\\repo\\src",
				type: "directory",
				hidden: false,
			},
		],
	],
	["D:\\repo\\src", []],
]);

const renderPicker = (initialValue = "C:\\Users\\eric") => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	function Harness() {
		const [value, setValue] = useState(initialValue);
		return (
			<QueryClientProvider client={queryClient}>
				<div data-testid="cwd-value">{value}</div>
				<WorkingDirectoryPicker
					open={true}
					value={value}
					onChange={setValue}
					machineId="machine-1"
				/>
			</QueryClientProvider>
		);
	}

	return render(<Harness />);
};

describe("WorkingDirectoryPicker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiMocks.fetchFsRoots.mockResolvedValue({
			homePath: "C:\\Users\\eric",
			roots: [
				{ name: "Home", path: "C:\\Users\\eric" },
				{ name: "C:", path: "C:\\" },
				{ name: "D:", path: "D:\\" },
			],
		});
		apiMocks.fetchFsEntries.mockImplementation(async ({ path }) => {
			const entries = directoryEntries.get(path);
			if (!entries) {
				throw new Error(`Unknown path: ${path}`);
			}
			const response: FsEntriesResponse = {
				path,
				entries,
			};
			return response;
		});
	});

	it("renders root buttons when multiple roots are available", async () => {
		renderPicker();

		expect(await screen.findByRole("button", { name: "Home" })).toBeVisible();
		expect(screen.getByRole("button", { name: "C:" })).toBeVisible();
		expect(screen.getByRole("button", { name: "D:" })).toBeVisible();
	});

	it("clicking D: updates the selected cwd to the drive root", async () => {
		const user = userEvent.setup();
		renderPicker();

		await user.click(await screen.findByRole("button", { name: "D:" }));

		await waitFor(() => {
			expect(screen.getByTestId("cwd-value")).toHaveTextContent("D:\\");
		});
		expect(
			within(screen.getByTestId("columns")).getByText("D:\\"),
		).toBeVisible();
	});

	it("switches the active root and builds Windows columns for manual cross-drive paths", async () => {
		const user = userEvent.setup();
		const view = renderPicker();

		const input = view.container.querySelector(
			'input[name="working-directory"]',
		);
		expect(input).toBeInstanceOf(HTMLInputElement);
		if (!(input instanceof HTMLInputElement)) {
			throw new Error("working-directory input not found");
		}
		await waitFor(() => {
			expect(input).toBeEnabled();
		});
		await user.clear(input);
		await user.type(input, "D:\\repo\\src{enter}");

		await waitFor(() => {
			expect(screen.getByTestId("cwd-value")).toHaveTextContent(
				"D:\\repo\\src",
			);
		});
		expect(screen.getByRole("button", { name: "D:" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		const columns = within(screen.getByTestId("columns"));
		expect(columns.getByText("D:\\")).toBeVisible();
		expect(columns.getByText("D:\\repo")).toBeVisible();
		expect(columns.getByText("D:\\repo\\src")).toBeVisible();
	});
});
