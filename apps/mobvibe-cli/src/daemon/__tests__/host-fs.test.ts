import { describe, expect, test } from "bun:test";
import type { FsEntry } from "@mobvibe/shared";
import {
	buildHostFsEntries,
	buildHostFsRoots,
	buildWindowsPathSegments,
	WINDOWS_HOST_ROOT_NAME,
	WINDOWS_HOST_ROOT_PATH,
} from "../host-fs.js";

const createDirectoryEntry = (name: string, entryPath: string): FsEntry => ({
	name,
	path: entryPath,
	type: "directory",
	hidden: false,
});

describe("host-fs", () => {
	test("returns a single fake root on Windows", async () => {
		const result = await buildHostFsRoots("win32", "C:\\Users\\tester");

		expect(result).toEqual({
			homePath: "C:\\Users\\tester",
			roots: [{ name: WINDOWS_HOST_ROOT_NAME, path: WINDOWS_HOST_ROOT_PATH }],
		});
	});

	test("builds Windows path segments from a real path", () => {
		expect(buildWindowsPathSegments("D:\\repo\\src")).toEqual([
			{
				name: WINDOWS_HOST_ROOT_NAME,
				path: WINDOWS_HOST_ROOT_PATH,
				selectable: false,
			},
			{ name: "D:", path: "D:\\" },
			{ name: "repo", path: "D:\\repo" },
			{ name: "src", path: "D:\\repo\\src" },
		]);
	});

	test("returns drive entries when requesting the Windows fake root", async () => {
		const result = await buildHostFsEntries(
			WINDOWS_HOST_ROOT_PATH,
			async () => [],
			"win32",
			async () => [
				createDirectoryEntry("C:", "C:\\"),
				createDirectoryEntry("D:", "D:\\"),
			],
		);

		expect(result).toEqual({
			path: WINDOWS_HOST_ROOT_PATH,
			entries: [
				createDirectoryEntry("C:", "C:\\"),
				createDirectoryEntry("D:", "D:\\"),
			],
		});
	});

	test("returns real entries and segments for Windows paths", async () => {
		const result = await buildHostFsEntries(
			"D:\\repo\\src",
			async (dirPath) => [createDirectoryEntry("nested", `${dirPath}\\nested`)],
			"win32",
		);

		expect(result).toEqual({
			path: "D:\\repo\\src",
			entries: [createDirectoryEntry("nested", "D:\\repo\\src\\nested")],
			segments: [
				{
					name: WINDOWS_HOST_ROOT_NAME,
					path: WINDOWS_HOST_ROOT_PATH,
					selectable: false,
				},
				{ name: "D:", path: "D:\\" },
				{ name: "repo", path: "D:\\repo" },
				{ name: "src", path: "D:\\repo\\src" },
			],
		});
	});
});
