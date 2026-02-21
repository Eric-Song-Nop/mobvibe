import {
	ArrowDown01Icon,
	ArrowRight01Icon,
	FilterIcon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileTypeLabel } from "@/components/app/file-type-label";
import { UnifiedDiffView } from "@/components/chat/DiffView";
import { Button } from "@/components/ui/button";
import { fetchSessionGitLog, fetchSessionGitShow } from "@/lib/api";
import { cn } from "@/lib/utils";

type CommitHistoryPanelProps = {
	sessionId: string;
	onFileSelect?: (hash: string, filePath: string, diff: string) => void;
};

const PAGE_SIZE = 50;

export function CommitHistoryPanel({
	sessionId,
	onFileSelect,
}: CommitHistoryPanelProps) {
	const { t } = useTranslation();
	const [authorFilter, setAuthorFilter] = useState("");
	const [pathFilter, setPathFilter] = useState("");
	const [filtersVisible, setFiltersVisible] = useState(false);
	const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
	const [expandedFile, setExpandedFile] = useState<string | null>(null);

	const parentRef = useRef<HTMLDivElement>(null);

	const logQuery = useInfiniteQuery({
		queryKey: [
			"session-git-log",
			sessionId,
			authorFilter.trim(),
			pathFilter.trim(),
		],
		queryFn: ({ pageParam }) =>
			fetchSessionGitLog({
				sessionId,
				maxCount: PAGE_SIZE,
				skip: pageParam,
				author: authorFilter.trim() || undefined,
				path: pathFilter.trim() || undefined,
			}),
		initialPageParam: 0,
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			lastPage.hasMore ? lastPageParam + PAGE_SIZE : undefined,
		staleTime: 60_000,
	});

	const allEntries = useMemo(
		() => logQuery.data?.pages.flatMap((p) => p.entries) ?? [],
		[logQuery.data],
	);

	const rowVirtualizer = useVirtualizer({
		count: allEntries.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 48,
		overscan: 10,
	});

	const toggleCommit = useCallback((hash: string) => {
		setExpandedCommit((prev) => (prev === hash ? null : hash));
		setExpandedFile(null);
	}, []);

	const toggleFilters = useCallback(() => {
		setFiltersVisible((prev) => !prev);
	}, []);

	const isEmpty =
		!logQuery.isLoading &&
		!logQuery.isFetchingNextPage &&
		allEntries.length === 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2">
			{/* Filter controls */}
			<div className="flex items-center gap-2">
				<Button
					variant={filtersVisible ? "secondary" : "ghost"}
					size="sm"
					className="h-7 px-2"
					onClick={toggleFilters}
				>
					<HugeiconsIcon
						icon={FilterIcon}
						strokeWidth={2}
						className="h-3.5 w-3.5"
						aria-hidden="true"
					/>
				</Button>
			</div>

			{filtersVisible ? (
				<div className="flex flex-col gap-1.5 px-1">
					<input
						type="text"
						className="border-input bg-background h-7 rounded border px-2 text-xs placeholder:text-muted-foreground"
						placeholder={t("fileExplorer.commitAuthorFilter")}
						value={authorFilter}
						onChange={(e) => setAuthorFilter(e.target.value)}
					/>
					<input
						type="text"
						className="border-input bg-background h-7 rounded border px-2 text-xs placeholder:text-muted-foreground"
						placeholder={t("fileExplorer.commitPathFilter")}
						value={pathFilter}
						onChange={(e) => setPathFilter(e.target.value)}
					/>
				</div>
			) : null}

			{/* Commit list */}
			<div
				ref={parentRef}
				className="border-input bg-muted/30 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-none border"
			>
				{logQuery.isLoading ? (
					<div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs">
						<HugeiconsIcon
							icon={Loading03Icon}
							strokeWidth={2}
							className="h-4 w-4 animate-spin"
							aria-hidden="true"
						/>
						{t("fileExplorer.commitLoading")}
					</div>
				) : isEmpty ? (
					<div className="text-muted-foreground flex flex-1 items-center justify-center text-xs">
						{t("fileExplorer.commitNoResults")}
					</div>
				) : (
					<>
						<div
							style={{
								height: `${rowVirtualizer.getTotalSize()}px`,
								width: "100%",
								position: "relative",
							}}
						>
							{rowVirtualizer.getVirtualItems().map((virtualItem) => {
								const entry = allEntries[virtualItem.index];
								const isExpanded = expandedCommit === entry.hash;

								return (
									<div
										key={entry.hash}
										data-index={virtualItem.index}
										ref={rowVirtualizer.measureElement}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											width: "100%",
											transform: `translateY(${virtualItem.start}px)`,
										}}
									>
										<CommitRow
											entry={entry}
											isExpanded={isExpanded}
											onToggle={() => toggleCommit(entry.hash)}
											sessionId={sessionId}
											expandedFile={expandedFile}
											onToggleFile={setExpandedFile}
											onFileSelect={onFileSelect}
											getLabel={t}
										/>
									</div>
								);
							})}
						</div>

						{logQuery.hasNextPage ? (
							<button
								type="button"
								className="text-primary hover:underline py-2 text-center text-xs"
								onClick={() => logQuery.fetchNextPage()}
								disabled={logQuery.isFetchingNextPage}
							>
								{logQuery.isFetchingNextPage
									? t("fileExplorer.commitLoading")
									: t("fileExplorer.commitLoadMore")}
							</button>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}

// --- CommitRow sub-component ---

type CommitRowProps = {
	entry: {
		hash: string;
		shortHash: string;
		author: string;
		date: string;
		subject: string;
		insertions?: number;
		deletions?: number;
	};
	isExpanded: boolean;
	onToggle: () => void;
	sessionId: string;
	expandedFile: string | null;
	onToggleFile: (key: string | null) => void;
	onFileSelect?: (hash: string, filePath: string, diff: string) => void;
	getLabel: (key: string, options?: Record<string, unknown>) => string;
};

function CommitRow({
	entry,
	isExpanded,
	onToggle,
	sessionId,
	expandedFile,
	onToggleFile,
	onFileSelect,
	getLabel,
}: CommitRowProps) {
	const { t } = useTranslation();
	const formattedDate = useMemo(() => {
		try {
			return new Date(entry.date).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		} catch {
			return entry.date;
		}
	}, [entry.date]);

	return (
		<div className="flex flex-col">
			<button
				type="button"
				className="hover:bg-muted flex min-h-[48px] w-full items-start gap-2 px-3 py-2 text-left text-xs"
				onClick={onToggle}
			>
				<HugeiconsIcon
					icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
					strokeWidth={2}
					className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate font-medium">{entry.subject}</span>
					<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-[10px]">
						<span className="font-mono">{entry.shortHash}</span>
						<span>{entry.author}</span>
						<span>{formattedDate}</span>
						{entry.insertions !== undefined || entry.deletions !== undefined ? (
							<span>
								<span className="text-emerald-600">
									+{entry.insertions ?? 0}
								</span>{" "}
								<span className="text-destructive">
									-{entry.deletions ?? 0}
								</span>
							</span>
						) : null}
					</div>
				</div>
			</button>

			{isExpanded ? (
				<CommitDetail
					sessionId={sessionId}
					hash={entry.hash}
					expandedFile={expandedFile}
					onToggleFile={onToggleFile}
					onFileSelect={onFileSelect}
					getLabel={getLabel}
					t={t}
				/>
			) : null}
		</div>
	);
}

// --- CommitDetail sub-component ---

type CommitDetailProps = {
	sessionId: string;
	hash: string;
	expandedFile: string | null;
	onToggleFile: (key: string | null) => void;
	onFileSelect?: (hash: string, filePath: string, diff: string) => void;
	getLabel: (key: string, options?: Record<string, unknown>) => string;
	t: (key: string, options?: Record<string, unknown>) => string;
};

function CommitDetail({
	sessionId,
	hash,
	expandedFile,
	onToggleFile,
	onFileSelect,
	getLabel,
	t,
}: CommitDetailProps) {
	const detailQuery = useQuery({
		queryKey: ["session-git-show", sessionId, hash],
		queryFn: () => fetchSessionGitShow({ sessionId, hash }),
		staleTime: 300_000, // Commit content does not change
	});

	if (detailQuery.isLoading) {
		return (
			<div className="text-muted-foreground flex items-center gap-2 px-8 py-2 text-xs">
				<HugeiconsIcon
					icon={Loading03Icon}
					strokeWidth={2}
					className="h-3.5 w-3.5 animate-spin"
					aria-hidden="true"
				/>
				{t("fileExplorer.commitLoading")}
			</div>
		);
	}

	if (!detailQuery.data) {
		return null;
	}

	const { files } = detailQuery.data;

	return (
		<div className="bg-muted/20 flex flex-col border-t border-border">
			<div className="text-muted-foreground px-8 py-1.5 text-[10px]">
				{t("fileExplorer.commitFilesChanged", { count: files.length })}
			</div>
			{files.map((file) => {
				const fileKey = `${hash}:${file.path}`;
				const isFileExpanded = expandedFile === fileKey;

				return (
					<div key={file.path} className="flex flex-col">
						<button
							type="button"
							className={cn(
								"hover:bg-muted flex min-h-[2.75rem] w-full items-center gap-2 px-8 py-1 text-left text-xs",
								isFileExpanded && "bg-muted/50",
							)}
							onClick={() => {
								onToggleFile(isFileExpanded ? null : fileKey);
								if (file.diff && onFileSelect) {
									onFileSelect(hash, file.path, file.diff);
								}
							}}
						>
							<FileTypeLabel path={file.path} />
							<span className="min-w-0 flex-1 truncate">{file.path}</span>
							<span className="text-muted-foreground shrink-0 text-[10px]">
								<span className="text-emerald-600">+{file.insertions}</span>{" "}
								<span className="text-destructive">-{file.deletions}</span>
							</span>
						</button>
						{isFileExpanded && file.diff ? (
							<div className="px-4 py-2">
								<UnifiedDiffView
									diff={file.diff}
									path={file.path}
									getLabel={getLabel}
								/>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
