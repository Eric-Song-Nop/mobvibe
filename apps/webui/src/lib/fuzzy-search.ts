import uFuzzy from "@leeoniya/ufuzzy";
import type { ReactNode } from "react";
import { createElement } from "react";

export type FuzzySearchResult<T> = {
	item: T;
	score: number;
	highlightRanges: [number, number][];
};

const uf = new uFuzzy();

export function fuzzySearch<T>(options: {
	items: T[];
	getText: (item: T) => string;
	query: string;
}): FuzzySearchResult<T>[] {
	const { items, getText, query } = options;
	const trimmed = query.trim();

	if (!trimmed) {
		return items.map((item) => ({
			item,
			score: 0,
			highlightRanges: [],
		}));
	}

	const haystack = items.map(getText);
	const result = uf.search(haystack, trimmed);

	if (!result[0] || !result[1]) {
		return [];
	}

	const [idxs, info, order] = [result[0], result[1], result[2]];

	const sortedOrder = order ?? idxs.map((_, i) => i);

	return sortedOrder.map((oi) => {
		const idx = idxs[oi];
		const ranges = info.ranges[oi];
		const highlightRanges: [number, number][] = [];
		for (let i = 0; i < ranges.length; i += 2) {
			highlightRanges.push([ranges[i], ranges[i + 1]]);
		}
		return {
			item: items[idx],
			score: oi,
			highlightRanges,
		};
	});
}

/**
 * Slice global highlight ranges to a sub-segment of the search text.
 * Returns ranges adjusted to be relative to the segment start.
 */
export function sliceHighlightRanges(
	ranges: [number, number][],
	segmentStart: number,
	segmentEnd: number,
): [number, number][] {
	const result: [number, number][] = [];
	for (const [start, end] of ranges) {
		if (end <= segmentStart || start >= segmentEnd) {
			continue;
		}
		result.push([
			Math.max(start, segmentStart) - segmentStart,
			Math.min(end, segmentEnd) - segmentStart,
		]);
	}
	return result;
}

export type FuzzyHighlightProps = {
	text: string;
	ranges: [number, number][];
	className?: string;
	markClassName?: string;
};

export function FuzzyHighlight({
	text,
	ranges,
	className,
	markClassName,
}: FuzzyHighlightProps): ReactNode {
	if (ranges.length === 0) {
		return createElement("span", { className }, text);
	}

	const parts: ReactNode[] = [];
	let cursor = 0;

	for (let i = 0; i < ranges.length; i++) {
		const [start, end] = ranges[i];
		if (cursor < start) {
			parts.push(text.slice(cursor, start));
		}
		parts.push(
			createElement(
				"mark",
				{
					key: i,
					className:
						markClassName ?? "bg-yellow-200/60 text-inherit rounded-sm",
				},
				text.slice(start, end),
			),
		);
		cursor = end;
	}

	if (cursor < text.length) {
		parts.push(text.slice(cursor));
	}

	return createElement("span", { className }, ...parts);
}
