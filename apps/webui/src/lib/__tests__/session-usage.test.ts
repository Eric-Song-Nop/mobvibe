import { describe, expect, it } from "vitest";
import {
	formatSessionCost,
	formatSessionTokenUsage,
	getContextLeftPercent,
} from "@/lib/session-usage";

describe("getContextLeftPercent", () => {
	it("returns the rounded remaining context percentage", () => {
		expect(getContextLeftPercent({ used: 260, size: 1000 })).toBe(74);
	});

	it("clamps the percentage to the 0..100 range", () => {
		expect(getContextLeftPercent({ used: 150, size: 100 })).toBe(0);
		expect(getContextLeftPercent({ used: 0, size: 100 })).toBe(100);
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
		expect(getContextLeftPercent({ used: -10, size: 100 })).toBeUndefined();
	});
});

describe("formatSessionTokenUsage", () => {
	it("formats the exact used and size values for the selected locale", () => {
		expect(
			formatSessionTokenUsage({ used: 1_234, size: 200_000 }, "en-US"),
		).toBe("1,234 / 200,000");
	});

	it("does not invent a value when either token count is invalid", () => {
		expect(
			formatSessionTokenUsage({ used: Number.NaN, size: 200_000 }, "en-US"),
		).toBeUndefined();
		expect(
			formatSessionTokenUsage(
				{ used: 1_234, size: Number.POSITIVE_INFINITY },
				"en-US",
			),
		).toBeUndefined();
		expect(
			formatSessionTokenUsage({ used: -1, size: 200_000 }, "en-US"),
		).toBeUndefined();
		expect(
			formatSessionTokenUsage({ used: 0, size: 0 }, "en-US"),
		).toBeUndefined();
	});
});

describe("formatSessionCost", () => {
	it("formats valid ISO 4217-like currencies without rounding the amount", () => {
		const result = formatSessionCost(
			{ amount: 0.000_123, currency: "USD" },
			"en-US",
		);

		expect(result).toContain("USD");
		expect(result).toContain("0.000123");
	});

	it("uses safe text for malformed currency codes", () => {
		expect(
			formatSessionCost({ amount: 12.34, currency: "not-a-currency" }, "en-US"),
		).toBe("12.34 not-a-currency");
	});

	it("does not pass unsupported three-letter codes to currency formatting", () => {
		expect(formatSessionCost({ amount: 12.34, currency: "ZZZ" }, "en-US")).toBe(
			"12.34 ZZZ",
		);
	});

	it("falls back to text when the locale is malformed", () => {
		expect(
			formatSessionCost({ amount: 12.34, currency: "USD" }, "not_a_locale"),
		).toBe("12.34 USD");
	});

	it("does not invent a cost when the amount is invalid", () => {
		expect(
			formatSessionCost({ amount: Number.NaN, currency: "USD" }, "en-US"),
		).toBeUndefined();
		expect(
			formatSessionCost({ amount: -0.01, currency: "USD" }, "en-US"),
		).toBeUndefined();
	});
});
