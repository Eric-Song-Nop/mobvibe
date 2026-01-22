import type { AvailableCommand } from "@/lib/acp";

export type CommandSearchItem = {
	command: AvailableCommand;
	searchText: string;
};

const buildSearchText = (command: AvailableCommand) => {
	const hint = command.input?.hint ?? "";
	return `${command.name} ${command.description} ${hint}`.toLowerCase();
};

export const buildCommandSearchItems = (
	commands: AvailableCommand[],
): CommandSearchItem[] =>
	commands.map((command) => ({
		command,
		searchText: buildSearchText(command),
	}));

export const filterCommandItems = (
	items: CommandSearchItem[],
	query: string,
): AvailableCommand[] => {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return items.map((item) => item.command);
	}
	return items
		.filter((item) => item.searchText.includes(normalized))
		.map((item) => item.command);
};
