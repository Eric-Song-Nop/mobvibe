import type { SessionFsResourceEntry } from "@/lib/api";
import { type FuzzySearchResult, fuzzySearch } from "@/lib/fuzzy-search";

export const filterResourceItems = (
	entries: SessionFsResourceEntry[],
	query: string,
): FuzzySearchResult<SessionFsResourceEntry>[] =>
	fuzzySearch({
		items: entries,
		getText: (e) => `${e.name} ${e.relativePath}`,
		query,
	});
