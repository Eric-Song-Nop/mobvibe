import { describe, expect, it } from "vitest";
import {
	createAutoScrollState,
	shouldAutoScroll,
	updateAutoScrollState,
} from "../src/lib/auto-scroll";

type MetricsOverrides = Partial<Parameters<typeof updateAutoScrollState>[1]>;

const buildMetrics = (overrides?: MetricsOverrides) => ({
	scrollTop: 0,
	scrollHeight: 1000,
	clientHeight: 400,
	threshold: 80,
	...overrides,
});

describe("auto scroll state", () => {
	it("marks manual scroll when user scrolls up", () => {
		const initial = { ...createAutoScrollState(), lastScrollTop: 200 };
		const next = updateAutoScrollState(
			initial,
			buildMetrics({ scrollTop: 120 }),
		);

		expect(next.hasUserScrolled).toBe(true);
		expect(
			shouldAutoScroll(next, { sessionChanged: false, hasMessages: true }),
		).toBe(false);
	});

	it("clears manual scroll after returning to bottom", () => {
		const state = {
			isAtBottom: false,
			hasUserScrolled: true,
			lastScrollTop: 120,
		};
		const next = updateAutoScrollState(state, buildMetrics({ scrollTop: 520 }));

		expect(next.isAtBottom).toBe(true);
		expect(next.hasUserScrolled).toBe(false);
	});

	it("allows auto scroll after session change", () => {
		const state = createAutoScrollState();

		expect(
			shouldAutoScroll(state, { sessionChanged: true, hasMessages: true }),
		).toBe(true);
	});
});
