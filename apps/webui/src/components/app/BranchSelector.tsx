import {
	GitBranchIcon,
	Loading03Icon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { fetchSessionGitBranches } from "@/lib/api";
import {
	FuzzyHighlight,
	type FuzzySearchResult,
	fuzzySearch,
} from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";

type BranchSelectorProps = {
	sessionId: string;
	currentBranch?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function BranchSelector({
	sessionId,
	currentBranch,
	open,
	onOpenChange,
}: BranchSelectorProps) {
	const { t } = useTranslation();
	const [searchQuery, setSearchQuery] = useState("");

	const branchesQuery = useQuery({
		queryKey: ["session-git-branches", sessionId],
		queryFn: () => fetchSessionGitBranches({ sessionId }),
		enabled: open,
		staleTime: 30_000,
	});

	const branches = branchesQuery.data?.branches ?? [];

	const filteredResults: FuzzySearchResult<(typeof branches)[number]>[] =
		useMemo(
			() =>
				fuzzySearch({
					items: branches,
					getText: (b) => b.name,
					query: searchQuery,
				}),
			[branches, searchQuery],
		);

	const isEmpty = !branchesQuery.isLoading && branches.length === 0;
	const noMatches =
		!branchesQuery.isLoading &&
		branches.length > 0 &&
		filteredResults.length === 0;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="bottom"
				className="sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[70vh] sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border"
			>
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<HugeiconsIcon
							icon={GitBranchIcon}
							strokeWidth={2}
							className="h-4 w-4"
							aria-hidden="true"
						/>
						{t("branchSelector.title")}
					</SheetTitle>
				</SheetHeader>

				{/* Search input */}
				<div className="relative px-4 pb-2">
					<HugeiconsIcon
						icon={Search01Icon}
						strokeWidth={2}
						className="absolute top-1/2 left-6 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						type="text"
						className="border-input bg-background h-8 w-full rounded border pl-8 pr-2 text-xs placeholder:text-muted-foreground"
						placeholder={t("branchSelector.searchPlaceholder")}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						autoFocus
					/>
				</div>

				{/* Branch list */}
				<div className="flex max-h-[50vh] flex-col overflow-y-auto px-2 pb-4">
					{branchesQuery.isLoading ? (
						<div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs">
							<HugeiconsIcon
								icon={Loading03Icon}
								strokeWidth={2}
								className="h-4 w-4 animate-spin"
								aria-hidden="true"
							/>
						</div>
					) : isEmpty ? (
						<div className="text-muted-foreground py-6 text-center text-xs">
							{t("branchSelector.noBranches")}
						</div>
					) : noMatches ? (
						<div className="text-muted-foreground py-6 text-center text-xs">
							{t("branchSelector.noMatches")}
						</div>
					) : (
						filteredResults.map((result) => {
							const branch = result.item;
							const isCurrent = branch.name === currentBranch;
							const isRemote = !!branch.remote;

							return (
								<div
									key={branch.name}
									className={cn(
										"flex min-h-[2.75rem] items-center gap-2 rounded px-2 py-1.5 text-xs",
										isCurrent && "bg-muted",
									)}
								>
									<HugeiconsIcon
										icon={GitBranchIcon}
										strokeWidth={2}
										className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<FuzzyHighlight
											text={branch.name}
											ranges={result.highlightRanges}
											className="truncate font-medium"
										/>
										<div className="flex items-center gap-2 text-muted-foreground text-[10px]">
											{branch.lastCommitDate ? (
												<span>
													{new Date(branch.lastCommitDate).toLocaleDateString(
														undefined,
														{
															month: "short",
															day: "numeric",
														},
													)}
												</span>
											) : null}
											{branch.aheadBehind ? (
												<span>
													↑{branch.aheadBehind.ahead} ↓
													{branch.aheadBehind.behind}
												</span>
											) : null}
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										{isCurrent ? (
											<span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
												{t("branchSelector.current")}
											</span>
										) : null}
										{isRemote ? (
											<span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
												{t("branchSelector.remote")}
											</span>
										) : null}
									</div>
								</div>
							);
						})
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
