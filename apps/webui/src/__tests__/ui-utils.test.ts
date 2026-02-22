import { describe, expect, it } from "vitest";
import { getPathBasename } from "@/lib/ui-utils";

describe("getPathBasename", () => {
	it("extracts basename from a normal path", () => {
		expect(getPathBasename("/home/user/project")).toBe("project");
	});

	it("handles trailing slashes", () => {
		expect(getPathBasename("/home/user/project/")).toBe("project");
		expect(getPathBasename("/home/user/project///")).toBe("project");
	});

	it("returns undefined for undefined input", () => {
		expect(getPathBasename(undefined)).toBeUndefined();
	});

	it("returns undefined for empty string", () => {
		expect(getPathBasename("")).toBeUndefined();
	});

	it("handles Windows-style backslash paths", () => {
		expect(getPathBasename("C:\\Users\\user\\project")).toBe("project");
		expect(getPathBasename("C:\\Users\\user\\project\\")).toBe("project");
	});

	it("handles mixed separator paths", () => {
		expect(getPathBasename("C:\\Users/user\\project")).toBe("project");
	});

	it("handles single segment paths", () => {
		expect(getPathBasename("project")).toBe("project");
	});

	it("returns undefined for root-only paths", () => {
		expect(getPathBasename("/")).toBeUndefined();
		expect(getPathBasename("\\")).toBeUndefined();
	});
});
