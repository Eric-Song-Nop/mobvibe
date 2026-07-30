import { describe, expect, it } from "vitest";
import { sanitizeReportedTokenUsage } from "../src/reported-token-usage.js";

describe("sanitizeReportedTokenUsage", () => {
	it("normalizes the fixed counters and drops null metadata fields", () => {
		expect(
			sanitizeReportedTokenUsage({
				totalTokens: 120,
				inputTokens: 80,
				outputTokens: 40,
				thoughtTokens: null,
				cachedReadTokens: 12,
				cachedWriteTokens: 3,
				_meta: { ignored: true },
				extra: "ignored",
			}),
		).toEqual({
			totalTokens: 120,
			inputTokens: 80,
			outputTokens: 40,
			cachedReadTokens: 12,
			cachedWriteTokens: 3,
		});
	});

	it.each([
		{ totalTokens: -1, inputTokens: 0, outputTokens: 0 },
		{ totalTokens: 1.5, inputTokens: 1, outputTokens: 0 },
		{
			totalTokens: Number.MAX_SAFE_INTEGER + 1,
			inputTokens: 1,
			outputTokens: 0,
		},
		{ totalTokens: 1, inputTokens: Number.NaN, outputTokens: 0 },
		{ totalTokens: 1, inputTokens: 1, outputTokens: 0, thoughtTokens: "2" },
		{ totalTokens: 1, inputTokens: 1 },
	])("omits the whole snapshot for invalid counters: $totalTokens", (value) => {
		expect(sanitizeReportedTokenUsage(value)).toBeUndefined();
	});
});
