import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FsEntriesResponse, FsEntry } from "@/lib/api";
import { ColumnFileBrowser, useColumnFileBrowser } from "../ColumnFileBrowser";

vi.mock("react-i18next", () => ({
	initReactI18next: { type: "3rdParty", init: () => {} },
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

const WINDOWS_HOST_ROOT_PATH = "__mobvibe_host_root__";

const createDirectoryEntry = (name: string, entryPath: string): FsEntry => ({
	name,
	path: entryPath,
	type: "directory",
	hidden: false,
});

describe("useColumnFileBrowser", () => {
	it("builds columns from backend segments for Windows host paths", async () => {
		const fetchEntries = vi.fn(
			async ({ path }: { path: string }): Promise<FsEntriesResponse> => {
				switch (path) {
					case WINDOWS_HOST_ROOT_PATH:
						return {
							path,
							entries: [createDirectoryEntry("D:", "D:\\")],
						};
					case "D:\\":
						return {
							path,
							entries: [createDirectoryEntry("repo", "D:\\repo")],
						};
					case "D:\\repo":
						return {
							path,
							entries: [createDirectoryEntry("src", "D:\\repo\\src")],
						};
					case "D:\\repo\\src":
						return {
							path,
							entries: [
								createDirectoryEntry("nested", "D:\\repo\\src\\nested"),
							],
							segments: [
								{
									name: "Computer",
									path: WINDOWS_HOST_ROOT_PATH,
									selectable: false,
								},
								{ name: "D:", path: "D:\\" },
								{ name: "repo", path: "D:\\repo" },
								{ name: "src", path: "D:\\repo\\src" },
							],
						};
					default:
						throw new Error(`Unexpected path: ${path}`);
				}
			},
		);
		const onChange = vi.fn();

		const { result } = renderHook(() =>
			useColumnFileBrowser({
				open: true,
				rootPath: WINDOWS_HOST_ROOT_PATH,
				rootLabel: "Computer",
				defaultPath: "C:\\Users\\tester",
				value: "D:\\repo\\src",
				onChange,
				fetchEntries,
				errorMessage: "failed",
			}),
		);

		await waitFor(() => {
			expect(result.current.columns).toHaveLength(4);
		});

		expect(result.current.columns.map((column) => column.name)).toEqual([
			"Computer",
			"D:",
			"repo",
			"src",
		]);
		expect(result.current.columns[0]?.selectable).toBe(false);
		expect(onChange).not.toHaveBeenCalledWith(WINDOWS_HOST_ROOT_PATH);
	});

	it("uses the provided default path instead of the fake root on first load", async () => {
		const fetchEntries = vi.fn(
			async ({ path }: { path: string }): Promise<FsEntriesResponse> => {
				switch (path) {
					case WINDOWS_HOST_ROOT_PATH:
						return {
							path,
							entries: [createDirectoryEntry("C:", "C:\\")],
						};
					case "C:\\":
						return {
							path,
							entries: [createDirectoryEntry("Users", "C:\\Users")],
						};
					case "C:\\Users":
						return {
							path,
							entries: [createDirectoryEntry("tester", "C:\\Users\\tester")],
						};
					case "C:\\Users\\tester":
						return {
							path,
							entries: [
								createDirectoryEntry("repo", "C:\\Users\\tester\\repo"),
							],
							segments: [
								{
									name: "Computer",
									path: WINDOWS_HOST_ROOT_PATH,
									selectable: false,
								},
								{ name: "C:", path: "C:\\" },
								{ name: "Users", path: "C:\\Users" },
								{ name: "tester", path: "C:\\Users\\tester" },
							],
						};
					default:
						throw new Error(`Unexpected path: ${path}`);
				}
			},
		);
		const onChange = vi.fn();

		renderHook(() =>
			useColumnFileBrowser({
				open: true,
				rootPath: WINDOWS_HOST_ROOT_PATH,
				rootLabel: "Computer",
				defaultPath: "C:\\Users\\tester",
				value: undefined,
				onChange,
				fetchEntries,
				errorMessage: "failed",
			}),
		);

		await waitFor(() => {
			expect(fetchEntries).toHaveBeenCalledWith({ path: "C:\\Users\\tester" });
		});
		expect(onChange).toHaveBeenCalledWith("C:\\Users\\tester");
		expect(onChange).not.toHaveBeenCalledWith(WINDOWS_HOST_ROOT_PATH);
	});
});

describe("ColumnFileBrowser", () => {
	it("disables non-selectable column headers", () => {
		render(
			<ColumnFileBrowser
				columns={[
					{
						name: "Computer",
						path: WINDOWS_HOST_ROOT_PATH,
						entries: [],
						selectable: false,
					},
				]}
				onColumnSelect={() => {}}
				onEntrySelect={() => {}}
				scrollContainerRef={{ current: null }}
				columnRefs={{ current: {} }}
			/>,
		);

		expect(screen.getByRole("button", { name: "Computer" })).toBeDisabled();
	});
});
