import { describe, expect, it } from "vitest";
import { getContextLeftPercent } from "@/lib/session-usage";

describe("getContextLeftPercent", () => {
	it("returns the rounded remaining context percentage", () => {
		expect(getContextLeftPercent({ used: 260, size: 1000 })).toBe(74);
	});

	it("clamps the percentage to the 0..100 range", () => {
		expect(getContextLeftPercent({ used: 150, size: 100 })).toBe(0);
		expect(getContextLeftPercent({ used: -10, size: 100 })).toBe(100);
	});

	it("returns undefined for missing or invalid usage values", () => {
		expect(getContextLeftPercent(undefined)).toBeUndefined();
		expect(getContextLeftPercent({ used: 10, size: 0 })).toBeUndefined();
		expect(
			getContextLeftPercent({ used: Number.NaN, size: 100 }),
		).toBeUndefined();
		expect(
			getContextLeftPercent({ used: 10, size: Number.POSITIVE_INFINITY }),
		).toBeUndefined();
	});
});
