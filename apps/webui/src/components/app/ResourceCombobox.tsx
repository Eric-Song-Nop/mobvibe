import { File01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SessionFsResourceEntry } from "@/lib/api";
import {
	FuzzyHighlight,
	type FuzzySearchResult,
	sliceHighlightRanges,
} from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";

export type ResourceComboboxProps = {
	results: FuzzySearchResult<SessionFsResourceEntry>[];
	open: boolean;
	highlightedIndex: number;
	onHighlightChange: (index: number) => void;
	onSelect: (result: FuzzySearchResult<SessionFsResourceEntry>) => void;
	className?: string;
};

export function ResourceCombobox({
	results,
	open,
	highlightedIndex,
	onHighlightChange,
	onSelect,
	className,
}: ResourceComboboxProps) {
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
			{results.length === 0 ? (
				<div className="text-muted-foreground px-2 py-2 text-xs">
					{t("chat.noMatchingResource")}
				</div>
			) : (
				<div className="max-h-72 overflow-y-auto" ref={listRef}>
					{results.map((result, index) => {
						const { item: resource, highlightRanges } = result;
						const isHighlighted = index === highlightedIndex;

						// searchText = `${name} ${relativePath}`
						const nameLen = resource.name.length;
						const pathStart = nameLen + 1;
						const pathLen = resource.relativePath.length;
						const pathRanges = sliceHighlightRanges(
							highlightRanges,
							pathStart,
							pathStart + pathLen,
						);

						return (
							<button
								type="button"
								key={resource.path}
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
								onClick={() => onSelect(result)}
							>
								<HugeiconsIcon
									icon={File01Icon}
									strokeWidth={2}
									aria-hidden="true"
								/>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="font-medium">
										<FuzzyHighlight
											text={resource.relativePath}
											ranges={pathRanges}
										/>
									</span>
								</div>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
