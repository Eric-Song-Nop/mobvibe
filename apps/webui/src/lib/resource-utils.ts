import type { SessionFsResourceEntry } from "@/lib/api";

export type ResourceSearchItem = {
	entry: SessionFsResourceEntry;
	searchText: string;
};

export const buildResourceSearchItems = (
	entries: SessionFsResourceEntry[],
): ResourceSearchItem[] =>
	entries.map((entry) => ({
		entry,
		searchText: `${entry.name} ${entry.relativePath}`.toLowerCase(),
	}));

export const filterResourceItems = (
	items: ResourceSearchItem[],
	query: string,
): SessionFsResourceEntry[] => {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return items.map((item) => item.entry);
	}
	return items
		.filter((item) => item.searchText.includes(normalized))
		.map((item) => item.entry);
};
