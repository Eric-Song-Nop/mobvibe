import { describe, expect, mock, test } from "bun:test";
import { discoverHostFsRoots } from "../host-fs-roots.js";

const createDirectoryStats = () =>
	({
		isDirectory: () => true,
	}) as Awaited<ReturnType<typeof import("node:fs/promises").stat>>;

describe("discoverHostFsRoots", () => {
	test("returns Home plus accessible Windows drives in alphabetical order", async () => {
		const accessiblePaths = new Set(["D:\\", "C:\\"]);
		const stat = mock(async (rootPath: string) => {
			if (!accessiblePaths.has(rootPath)) {
				throw new Error("missing");
			}
			return createDirectoryStats();
		});
		const access = mock(async (rootPath: string) => {
			if (!accessiblePaths.has(rootPath)) {
				throw new Error("denied");
			}
		});

		const result = await discoverHostFsRoots({
			platform: "win32",
			homePath: "C:\\Users\\eric",
			stat,
			access,
		});

		expect(result).toEqual({
			homePath: "C:\\Users\\eric",
			roots: [
				{ name: "Home", path: "C:\\Users\\eric" },
				{ name: "C:", path: "C:\\" },
				{ name: "D:", path: "D:\\" },
			],
		});
	});

	test("deduplicates Windows roots by normalized path", async () => {
		const accessiblePaths = new Set(["C:\\", "D:\\"]);
		const stat = mock(async (rootPath: string) => {
			if (!accessiblePaths.has(rootPath)) {
				throw new Error("missing");
			}
			return createDirectoryStats();
		});
		const access = mock(async (rootPath: string) => {
			if (!accessiblePaths.has(rootPath)) {
				throw new Error("denied");
			}
		});

		const result = await discoverHostFsRoots({
			platform: "win32",
			homePath: "C:\\",
			stat,
			access,
		});

		expect(result.roots).toEqual([
			{ name: "Home", path: "C:\\" },
			{ name: "D:", path: "D:\\" },
		]);
	});

	test("keeps non-Windows behavior unchanged", async () => {
		const stat = mock(async (_rootPath: string) => createDirectoryStats());
		const access = mock(async (_rootPath: string) => {});

		const result = await discoverHostFsRoots({
			platform: "darwin",
			homePath: "/Users/eric",
			stat,
			access,
		});

		expect(result).toEqual({
			homePath: "/Users/eric",
			roots: [{ name: "Home", path: "/Users/eric" }],
		});
		expect(stat).not.toHaveBeenCalled();
		expect(access).not.toHaveBeenCalled();
	});
});
