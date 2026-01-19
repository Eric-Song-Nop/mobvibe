import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AvailableCommand } from "@/lib/acp";
import { cn } from "@/lib/utils";

export type CommandComboboxProps = {
	commands: AvailableCommand[];
	open: boolean;
	highlightedIndex: number;
	onHighlightChange: (index: number) => void;
	onSelect: (command: AvailableCommand) => void;
	className?: string;
};

const buildCommandLabel = (command: AvailableCommand) => `/${command.name}`;

export function CommandCombobox({
	commands,
	open,
	highlightedIndex,
	onHighlightChange,
	onSelect,
	className,
}: CommandComboboxProps) {
	const { t } = useTranslation();
	const listRef = useRef<HTMLDivElement | null>(null);
	const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const target = itemRefs.current[highlightedIndex];
		if (target) {
			target.scrollIntoView({ block: "nearest" });
		}
	}, [highlightedIndex, open]);

	if (!open) {
		return null;
	}

	return (
		<div
			className={cn(
				"bg-popover text-popover-foreground ring-foreground/10 shadow-md ring-1 z-50 w-full overflow-hidden rounded-none",
				className,
			)}
			role="listbox"
		>
			{commands.length === 0 ? (
				<div className="text-muted-foreground px-2 py-2 text-xs">
					{t("chat.noMatchingCommand")}
				</div>
			) : (
				<div className="max-h-72 overflow-y-auto" ref={listRef}>
					{commands.map((command, index) => {
						const isHighlighted = index === highlightedIndex;
						return (
							<button
								type="button"
								key={command.name}
								ref={(node) => {
									itemRefs.current[index] = node;
								}}
								className={cn(
									"flex w-full cursor-default items-start gap-2 px-2 py-2 text-left text-xs outline-none",
									isHighlighted
										? "bg-accent text-accent-foreground"
										: "text-foreground",
								)}
								role="option"
								aria-selected={isHighlighted}
								onMouseEnter={() => onHighlightChange(index)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => onSelect(command)}
							>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="font-medium">
										{buildCommandLabel(command)}
									</span>
									<span className="text-muted-foreground line-clamp-2">
										{command.description}
									</span>
									{command.input?.hint ? (
										<span className="text-muted-foreground/80 line-clamp-1">
											{command.input.hint}
										</span>
									) : null}
								</div>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
