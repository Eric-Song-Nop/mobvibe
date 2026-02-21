import type { AvailableCommand } from "@/lib/acp";
import { type FuzzySearchResult, fuzzySearch } from "@/lib/fuzzy-search";

export const filterCommandItems = (
	commands: AvailableCommand[],
	query: string,
): FuzzySearchResult<AvailableCommand>[] =>
	fuzzySearch({
		items: commands,
		getText: (cmd) => `${cmd.name} ${cmd.description} ${cmd.input?.hint ?? ""}`,
		query,
	});
