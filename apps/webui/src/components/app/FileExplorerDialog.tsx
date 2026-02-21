import {
	FolderOpenIcon,
	GitBranchIcon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BranchSelector } from "@/components/app/BranchSelector";
import {
	ColumnFileBrowser,
	useColumnFileBrowser,
} from "@/components/app/ColumnFileBrowser";
import { previewRenderers } from "@/components/app/file-preview-renderers";
import { GitChangesView } from "@/components/app/GitChangesView";
import { UnifiedDiffView } from "@/components/chat/DiffView";
import { CommitHistoryPanel } from "@/components/git/CommitHistoryPanel";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { FsEntry, GitFileStatus } from "@/lib/api";
import {
	fetchSessionFsEntries,
	fetchSessionFsFile,
	fetchSessionFsRoots,
	fetchSessionGitDiff,
	fetchSessionGitStatusExtended,
} from "@/lib/api";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { resolveFileNameFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

// --- Preview intent discriminated union ---

type PreviewIntent =
	| { type: "file"; path: string }
	| { type: "workingDiff"; relativePath: string }
	| { type: "commitDiff"; hash: string; filePath: string; diff: string };

export type FileExplorerDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sessionId?: string;
	initialFilePath?: string;
};

export function FileExplorerDialog({
	open,
	onOpenChange,
	sessionId,
	initialFilePath,
}: FileExplorerDialogProps) {
	const { t } = useTranslation();
	const [currentPath, setCurrentPath] = useState<string | undefined>();
	const [previewIntent, setPreviewIntent] = useState<
		PreviewIntent | undefined
	>();
	const [activePane, setActivePane] = useState<"browser" | "preview">(
		"browser",
	);
	const [activeTab, setActiveTab] = useState<"files" | "changes" | "history">(
		"files",
	);
	const [branchSelectorOpen, setBranchSelectorOpen] = useState(false);
	const previousPreviewPathRef = useRef<string | undefined>(undefined);

	// Derive selectedFilePath for UI display (file name, mobile toggle disabled state, etc.)
	const selectedFilePath = useMemo(() => {
		if (!previewIntent) return undefined;
		switch (previewIntent.type) {
			case "file":
				return previewIntent.path;
			case "workingDiff":
				return previewIntent.relativePath;
			case "commitDiff":
				return previewIntent.filePath;
		}
	}, [previewIntent]);

	const rootsQuery = useQuery({
		queryKey: ["session-fs-roots", sessionId],
		queryFn: () => {
			if (!sessionId) {
				throw createFallbackError(t("errors.sessionUnavailable"), "request");
			}
			return fetchSessionFsRoots({ sessionId });
		},
		enabled: open && !!sessionId,
	});

	const gitStatusQuery = useQuery({
		queryKey: ["session-git-status", sessionId],
		queryFn: () => {
			if (!sessionId) {
				throw createFallbackError(t("errors.sessionUnavailable"), "request");
			}
			return fetchSessionGitStatusExtended({ sessionId });
		},
		enabled: open && !!sessionId,
		staleTime: 30000, // Cache for 30 seconds
	});

	const root = rootsQuery.data?.root;
	const rootPath = root?.path;
	const rootLabel = root?.name ?? t("session.cwdLabel");
	const gitStatus = gitStatusQuery.data;

	const fetchEntries = useCallback(
		async (payload: { path: string }) => {
			if (!sessionId) {
				throw createFallbackError(t("errors.sessionUnavailable"), "request");
			}
			return fetchSessionFsEntries({ sessionId, path: payload.path });
		},
		[sessionId, t],
	);

	// --- Callbacks ---

	const handleDirectorySelect = useCallback((_nextPath: string) => {
		setPreviewIntent(undefined);
		setActivePane("browser");
	}, []);

	const handleFileSelect = useCallback((entry: FsEntry) => {
		setPreviewIntent({ type: "file", path: entry.path });
		setActivePane("preview");
	}, []);

	const handleChangesFileSelect = useCallback((relativePath: string) => {
		setPreviewIntent({ type: "workingDiff", relativePath });
		setActivePane("preview");
	}, []);

	const handleHistoryFileSelect = useCallback(
		(hash: string, filePath: string, diff: string) => {
			setPreviewIntent({ type: "commitDiff", hash, filePath, diff });
			setActivePane("preview");
		},
		[],
	);

	const handleTabChange = useCallback(
		(tab: "files" | "changes" | "history") => {
			setActiveTab(tab);
			setPreviewIntent(undefined);
			setActivePane("browser");
		},
		[],
	);

	const {
		columns,
		isLoading: entriesLoading,
		pathError,
		buildColumnsForPath,
		handleEntrySelect,
		handleColumnSelect,
		scrollContainerRef,
		columnRefs,
	} = useColumnFileBrowser({
		open,
		rootPath,
		rootLabel,
		value: currentPath,
		onChange: setCurrentPath,
		onSelect: handleDirectorySelect,
		onFileSelect: handleFileSelect,
		fetchEntries,
		errorMessage: t("errors.directoryLoadFailed"),
	});

	useEffect(() => {
		if (!open || !initialFilePath || !rootPath) {
			return;
		}
		if (!initialFilePath.startsWith(rootPath)) {
			return;
		}
		if (previousPreviewPathRef.current === initialFilePath) {
			return;
		}
		previousPreviewPathRef.current = initialFilePath;
		const parentPath = initialFilePath.split(/[/\\]/).slice(0, -1).join("/");
		void buildColumnsForPath(parentPath || rootPath);
	}, [buildColumnsForPath, initialFilePath, open, rootPath]);

	// --- Preview queries (conditional on intent type) ---

	const filePreviewQuery = useQuery({
		queryKey: [
			"session-fs-file",
			sessionId,
			previewIntent?.type === "file" ? previewIntent.path : null,
		],
		queryFn: () => {
			if (!sessionId || previewIntent?.type !== "file") {
				throw createFallbackError(t("errors.pathUnavailable"), "request");
			}
			return fetchSessionFsFile({ sessionId, path: previewIntent.path });
		},
		enabled: open && !!sessionId && previewIntent?.type === "file",
	});

	const workingDiffQuery = useQuery({
		queryKey: [
			"session-git-diff",
			sessionId,
			previewIntent?.type === "workingDiff" ? previewIntent.relativePath : null,
		],
		queryFn: () => {
			if (!sessionId || previewIntent?.type !== "workingDiff") {
				throw createFallbackError(t("errors.pathUnavailable"), "request");
			}
			return fetchSessionGitDiff({
				sessionId,
				path: previewIntent.relativePath,
			});
		},
		enabled: open && !!sessionId && previewIntent?.type === "workingDiff",
	});

	const resetState = useCallback(() => {
		setCurrentPath(undefined);
		setPreviewIntent(undefined);
		setActivePane("browser");
		setActiveTab("files");
	}, []);

	useEffect(() => {
		if (!open) {
			resetState();
			previousPreviewPathRef.current = undefined;
			return;
		}
		if (sessionId === undefined) {
			resetState();
			previousPreviewPathRef.current = undefined;
			return;
		}
		resetState();
		if (initialFilePath) {
			setPreviewIntent({ type: "file", path: initialFilePath });
			setActivePane("preview");
			return;
		}
	}, [initialFilePath, open, resetState, sessionId]);

	// --- Error handling ---

	const rootsError = rootsQuery.isError
		? normalizeError(
				rootsQuery.error,
				createFallbackError(t("errors.rootLoadFailed"), "request"),
			).message
		: undefined;
	const filePreviewError = filePreviewQuery.isError
		? normalizeError(
				filePreviewQuery.error,
				createFallbackError(t("errors.previewLoadFailed"), "request"),
			).message
		: undefined;

	const previewRenderer = useMemo(() => {
		if (!filePreviewQuery.data) {
			return undefined;
		}
		return previewRenderers[filePreviewQuery.data.previewType];
	}, [filePreviewQuery.data]);

	// --- Derived values ---

	const browserPaneClassName = cn(
		"min-h-0 flex-col gap-2",
		activePane === "browser" ? "flex" : "hidden",
		"sm:flex",
	);
	const previewPaneClassName = cn(
		"min-h-0 flex-col gap-2",
		activePane === "preview" ? "flex" : "hidden",
		"sm:flex",
	);

	const browserError = rootsError ?? pathError;
	const isBrowserLoading = rootsQuery.isLoading || entriesLoading;
	const selectedFileName = useMemo(
		() => resolveFileNameFromPath(selectedFilePath),
		[selectedFilePath],
	);

	// Preview panel title and mode label
	const previewModeLabel = useMemo(() => {
		if (!previewIntent) return undefined;
		switch (previewIntent.type) {
			case "file":
				return filePreviewQuery.data?.previewType === "image"
					? t("fileExplorer.imageMode")
					: t("fileExplorer.codeMode");
			case "workingDiff":
			case "commitDiff":
				return t("fileExplorer.diffMode");
		}
	}, [previewIntent, filePreviewQuery.data, t]);

	// For GitChangesView selected highlight (use relative path)
	const changesSelectedPath =
		previewIntent?.type === "workingDiff"
			? previewIntent.relativePath
			: undefined;

	// For ColumnFileBrowser highlighted entry (use absolute path)
	const filesHighlightedPath =
		previewIntent?.type === "file" ? previewIntent.path : undefined;

	const getGitStatusForPath = useCallback(
		(relativePath: string): GitFileStatus | undefined => {
			if (!gitStatus?.isGitRepo) {
				return undefined;
			}
			// Check staged files
			const stagedEntry = gitStatus.staged.find(
				(f) => f.path === relativePath || f.path === `${relativePath}/`,
			);
			if (stagedEntry) {
				return stagedEntry.status;
			}
			// Check unstaged files
			const unstagedEntry = gitStatus.unstaged.find(
				(f) => f.path === relativePath || f.path === `${relativePath}/`,
			);
			if (unstagedEntry) {
				return unstagedEntry.status;
			}
			// Check untracked files
			const untrackedEntry = gitStatus.untracked.find(
				(f) => f.path === relativePath || f.path === `${relativePath}/`,
			);
			if (untrackedEntry) {
				return "?";
			}
			// Check if it's a directory
			return gitStatus.dirStatus[relativePath];
		},
		[gitStatus],
	);

	// --- Render preview panel content based on intent type ---

	const renderPreviewContent = () => {
		if (!previewIntent) {
			return (
				<div className="text-muted-foreground flex flex-1 items-center justify-center px-3 text-xs">
					{t("fileExplorer.selectFileHint")}
				</div>
			);
		}

		switch (previewIntent.type) {
			case "file": {
				if (filePreviewQuery.isLoading) {
					return (
						<div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs">
							<HugeiconsIcon
								icon={Loading03Icon}
								strokeWidth={2}
								className="animate-spin"
								aria-hidden="true"
							/>
							{t("fileExplorer.loadingPreview")}
						</div>
					);
				}
				if (filePreviewError) {
					return (
						<div className="text-destructive flex flex-1 items-center justify-center px-3 text-xs">
							{filePreviewError}
						</div>
					);
				}
				if (filePreviewQuery.data && previewRenderer) {
					return previewRenderer(filePreviewQuery.data, sessionId);
				}
				return (
					<div className="text-muted-foreground flex flex-1 items-center justify-center px-3 text-xs">
						{t("fileExplorer.unsupportedFormat")}
					</div>
				);
			}

			case "workingDiff": {
				if (workingDiffQuery.isLoading) {
					return (
						<div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs">
							<HugeiconsIcon
								icon={Loading03Icon}
								strokeWidth={2}
								className="animate-spin"
								aria-hidden="true"
							/>
							{t("fileExplorer.loadingPreview")}
						</div>
					);
				}
				if (workingDiffQuery.data?.rawDiff) {
					return (
						<UnifiedDiffView
							diff={workingDiffQuery.data.rawDiff}
							path={previewIntent.relativePath}
							getLabel={t}
							fullHeight
						/>
					);
				}
				return (
					<div className="text-muted-foreground flex flex-1 items-center justify-center px-3 text-xs">
						{t("fileExplorer.noDiffAvailable")}
					</div>
				);
			}

			case "commitDiff": {
				if (previewIntent.diff) {
					return (
						<UnifiedDiffView
							diff={previewIntent.diff}
							path={previewIntent.filePath}
							getLabel={t}
							fullHeight
						/>
					);
				}
				return (
					<div className="text-muted-foreground flex flex-1 items-center justify-center px-3 text-xs">
						{t("fileExplorer.noDiffAvailable")}
					</div>
				);
			}
		}
	};

	return (
		<>
			<AlertDialog open={open} onOpenChange={onOpenChange}>
				<AlertDialogContent className="grid h-[100svh] w-[100vw] !max-w-none min-h-0 min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden translate-x-0 translate-y-0 rounded-none p-4 sm:h-[82vh] sm:!w-[98vw] sm:!max-w-[98vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-none top-0 left-0 sm:top-1/2 sm:left-1/2">
					<AlertDialogHeader className="gap-2">
						{/* Row 1: Icon + Tabs + Git Branch */}
						<div className="flex w-full items-center gap-2">
							<AlertDialogTitle className="flex min-w-0 items-center gap-2">
								<HugeiconsIcon
									icon={FolderOpenIcon}
									strokeWidth={2}
									className="shrink-0"
									aria-hidden="true"
								/>
								<div className="flex items-center gap-1">
									<Button
										variant={activeTab === "files" ? "secondary" : "ghost"}
										size="sm"
										className="h-7 px-2 text-sm font-medium"
										onClick={() => handleTabChange("files")}
									>
										{t("fileExplorer.filesTab")}
									</Button>
									{gitStatus?.isGitRepo ? (
										<Button
											variant={activeTab === "changes" ? "secondary" : "ghost"}
											size="sm"
											className="h-7 px-2 text-sm font-medium"
											onClick={() => handleTabChange("changes")}
										>
											{t("fileExplorer.changesTab")}
											{gitStatus.staged.length +
												gitStatus.unstaged.length +
												gitStatus.untracked.length >
											0 ? (
												<span className="text-muted-foreground ml-1 text-xs">
													(
													{gitStatus.staged.length +
														gitStatus.unstaged.length +
														gitStatus.untracked.length}
													)
												</span>
											) : null}
										</Button>
									) : null}
									{gitStatus?.isGitRepo ? (
										<Button
											variant={activeTab === "history" ? "secondary" : "ghost"}
											size="sm"
											className="h-7 px-2 text-sm font-medium"
											onClick={() => handleTabChange("history")}
										>
											{t("fileExplorer.historyTab")}
										</Button>
									) : null}
								</div>
							</AlertDialogTitle>
							{gitStatus?.isGitRepo && gitStatus.branch ? (
								<button
									type="button"
									className="text-muted-foreground hover:text-foreground hover:bg-muted ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal max-w-[8rem] transition-colors"
									onClick={() => setBranchSelectorOpen(true)}
								>
									<HugeiconsIcon
										icon={GitBranchIcon}
										strokeWidth={2}
										className="h-3.5 w-3.5 shrink-0"
										aria-hidden="true"
									/>
									<span className="truncate">{gitStatus.branch}</span>
								</button>
							) : null}
						</div>
						{/* Row 2: Pane toggle — mobile only */}
						<div className="flex items-center gap-2 sm:hidden">
							<Button
								variant={activePane === "browser" ? "secondary" : "outline"}
								size="sm"
								onClick={() => setActivePane("browser")}
							>
								{activeTab === "files"
									? t("fileExplorer.directories")
									: activeTab === "changes"
										? t("fileExplorer.changesTab")
										: t("fileExplorer.historyTab")}
							</Button>
							<Button
								variant={activePane === "preview" ? "secondary" : "outline"}
								size="sm"
								onClick={() => setActivePane("preview")}
								disabled={!previewIntent}
							>
								{t("fileExplorer.preview")}
							</Button>
						</div>
					</AlertDialogHeader>

					<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden sm:flex-row">
						<section
							className={cn(
								"flex-1 min-h-0 min-w-0 overflow-hidden sm:flex-none sm:w-[28rem]",
								browserPaneClassName,
							)}
						>
							{activeTab === "files" ? (
								<>
									<div className="flex items-center justify-between gap-2">
										<div className="text-xs font-medium">{rootLabel}</div>
										{currentPath ? (
											<span className="text-muted-foreground text-xs">
												{currentPath.replace(rootPath ?? "", "") || "/"}
											</span>
										) : null}
									</div>
									{browserError ? (
										<div className="text-destructive border-input bg-muted/30 flex min-h-0 flex-1 items-center justify-center rounded-none border text-xs">
											{browserError}
										</div>
									) : (
										<ColumnFileBrowser
											columns={columns}
											currentPath={currentPath}
											highlightedEntryPath={filesHighlightedPath ?? currentPath}
											onColumnSelect={handleColumnSelect}
											onEntrySelect={handleEntrySelect}
											isLoading={isBrowserLoading}
											scrollContainerRef={scrollContainerRef}
											columnRefs={columnRefs}
											className="min-h-0 min-w-0 flex-1"
											rootPath={rootPath}
											getGitStatus={getGitStatusForPath}
										/>
									)}
								</>
							) : activeTab === "changes" ? (
								<GitChangesView
									staged={gitStatus?.staged ?? []}
									unstaged={gitStatus?.unstaged ?? []}
									untracked={gitStatus?.untracked ?? []}
									onFileSelect={handleChangesFileSelect}
									selectedFilePath={changesSelectedPath}
								/>
							) : sessionId ? (
								<CommitHistoryPanel
									sessionId={sessionId}
									onFileSelect={handleHistoryFileSelect}
									selectedFile={
										previewIntent?.type === "commitDiff"
											? previewIntent.filePath
											: undefined
									}
								/>
							) : null}
						</section>

						<section
							className={cn(
								"flex min-h-0 min-w-0 flex-1 overflow-hidden",
								previewPaneClassName,
							)}
						>
							<div className="flex min-h-0 flex-1 flex-col gap-2">
								<div className="flex items-center justify-between gap-2">
									<div className="text-xs font-medium">
										{selectedFileName ?? t("fileExplorer.previewTitleFallback")}
									</div>
									{previewIntent ? (
										<span className="text-muted-foreground text-xs">
											{previewModeLabel}
										</span>
									) : null}
								</div>
								<div className="border-input bg-background flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-none border">
									{renderPreviewContent()}
								</div>
							</div>
						</section>
					</div>

					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{sessionId && gitStatus?.isGitRepo ? (
				<BranchSelector
					sessionId={sessionId}
					currentBranch={gitStatus.branch}
					open={branchSelectorOpen}
					onOpenChange={setBranchSelectorOpen}
				/>
			) : null}
		</>
	);
}
