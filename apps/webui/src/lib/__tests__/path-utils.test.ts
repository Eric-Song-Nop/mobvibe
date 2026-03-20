import { describe, expect, it } from "vitest";
import {
	appendPathSegment,
	buildPathSegments,
	findBestMatchingRoot,
	isPathAtRoot,
	normalizePathForComparison,
	trimTrailingPathSeparators,
} from "../path-utils";

describe("path-utils", () => {
	it("picks the longest matching Windows root prefix", () => {
		const roots = [
			{ name: "Home", path: "C:\\Users\\eric" },
			{ name: "C:", path: "C:\\" },
			{ name: "D:", path: "D:\\" },
		];

		expect(findBestMatchingRoot(roots, "C:\\Users\\eric")).toEqual(roots[0]);
		expect(findBestMatchingRoot(roots, "D:\\repo")).toEqual(roots[2]);
	});

	it("keeps Unix path behavior unchanged", () => {
		expect(trimTrailingPathSeparators("/")).toBe("/");
		expect(trimTrailingPathSeparators("/repo/src/")).toBe("/repo/src");
		expect(normalizePathForComparison("/repo/src")).toBe("/repo/src");
		expect(isPathAtRoot("/repo", "/repo")).toBe(true);
		expect(appendPathSegment("/repo", "src")).toBe("/repo/src");
		expect(buildPathSegments("/repo", "/repo/src/lib", "Root")).toEqual([
			{ name: "Root", path: "/repo" },
			{ name: "src", path: "/repo/src" },
			{ name: "lib", path: "/repo/src/lib" },
		]);
	});

	it("builds Windows breadcrumb segments with preserved separators", () => {
		expect(buildPathSegments("D:\\", "D:\\repo\\src", "D:")).toEqual([
			{ name: "D:", path: "D:\\" },
			{ name: "repo", path: "D:\\repo" },
			{ name: "src", path: "D:\\repo\\src" },
		]);
	});
});
