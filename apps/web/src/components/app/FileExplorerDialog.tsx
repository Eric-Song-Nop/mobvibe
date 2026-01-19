import { FolderOpenIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ColumnFileBrowser,
	useColumnFileBrowser,
} from "@/components/app/ColumnFileBrowser";
import { previewRenderers } from "@/components/app/file-preview-renderers";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { FsEntry } from "@/lib/api";
import {
	fetchSessionFsEntries,
	fetchSessionFsFile,
	fetchSessionFsRoots,
} from "@/lib/api";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { resolveFileNameFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

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
	const [selectedFilePath, setSelectedFilePath] = useState<
		string | undefined
	>();
	const [activePane, setActivePane] = useState<"browser" | "preview">(
		"browser",
	);

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

	const root = rootsQuery.data?.root;
	const rootPath = root?.path;
	const rootLabel = root?.name ?? t("session.cwdLabel");

	const fetchEntries = useCallback(
		async (payload: { path: string }) => {
			if (!sessionId) {
				throw createFallbackError(t("errors.sessionUnavailable"), "request");
			}
			return fetchSessionFsEntries({ sessionId, path: payload.path });
		},
		[sessionId, t],
	);

	const handleDirectorySelect = useCallback((_nextPath: string) => {
		setSelectedFilePath(undefined);
		setActivePane("browser");
	}, []);

	const handleFileSelect = useCallback((entry: FsEntry) => {
		setSelectedFilePath(entry.path);
		setActivePane("preview");
	}, []);

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
		const parentPath = initialFilePath.split(/[/\\]/).slice(0, -1).join("/");
		if (parentPath) {
			setCurrentPath(parentPath);
			void buildColumnsForPath(parentPath, true);
		}
	}, [buildColumnsForPath, initialFilePath, open, rootPath]);

	const previewQuery = useQuery({
		queryKey: ["session-fs-file", sessionId, selectedFilePath],
		queryFn: () => {
			if (!sessionId || !selectedFilePath) {
				throw createFallbackError(t("errors.pathUnavailable"), "request");
			}
			return fetchSessionFsFile({ sessionId, path: selectedFilePath });
		},
		enabled: open && !!sessionId && !!selectedFilePath,
	});

	const resetState = useCallback(() => {
		setCurrentPath(undefined);
		setSelectedFilePath(undefined);
		setActivePane("browser");
	}, []);

	useEffect(() => {
		if (!open) {
			resetState();
			return;
		}
		if (sessionId === undefined) {
			resetState();
			return;
		}
		resetState();
		if (initialFilePath) {
			setSelectedFilePath(initialFilePath);
			setActivePane("preview");
			return;
		}
	}, [initialFilePath, open, resetState, sessionId]);

	const rootsError = rootsQuery.isError
		? normalizeError(
				rootsQuery.error,
				createFallbackError(t("errors.rootLoadFailed"), "request"),
			).message
		: undefined;
	const previewError = previewQuery.isError
		? normalizeError(
				previewQuery.error,
				createFallbackError(t("errors.previewLoadFailed"), "request"),
			).message
		: undefined;

	const previewRenderer = useMemo(() => {
		if (!previewQuery.data) {
			return undefined;
		}
		return previewRenderers[previewQuery.data.previewType];
	}, [previewQuery.data]);

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

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="grid h-[100svh] w-[100vw] !max-w-none min-h-0 min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden translate-x-0 translate-y-0 rounded-none p-4 sm:h-[82vh] sm:!w-[98vw] sm:!max-w-[98vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-none top-0 left-0 sm:top-1/2 sm:left-1/2">
				<AlertDialogHeader className="gap-3">
					<div className="flex w-full items-center justify-between gap-3">
						<AlertDialogTitle className="flex items-center gap-2">
							<HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
							{t("fileExplorer.sessionFiles")}
						</AlertDialogTitle>
						<div className="flex items-center gap-2 sm:hidden">
							<Button
								variant={activePane === "browser" ? "secondary" : "outline"}
								size="sm"
								onClick={() => setActivePane("browser")}
							>
								{t("fileExplorer.directories")}
							</Button>
							<Button
								variant={activePane === "preview" ? "secondary" : "outline"}
								size="sm"
								onClick={() => setActivePane("preview")}
								disabled={!selectedFilePath}
							>
								{t("fileExplorer.preview")}
							</Button>
						</div>
					</div>
				</AlertDialogHeader>

				<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden sm:flex-row">
					<section
						className={cn(
							"flex-1 min-h-0 min-w-0 overflow-hidden sm:flex-none sm:w-[28rem]",
							browserPaneClassName,
						)}
					>
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
								highlightedEntryPath={selectedFilePath ?? currentPath}
								onColumnSelect={handleColumnSelect}
								onEntrySelect={handleEntrySelect}
								isLoading={isBrowserLoading}
								scrollContainerRef={scrollContainerRef}
								columnRefs={columnRefs}
								className="min-h-0 min-w-0 flex-1"
							/>
						)}
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
								{selectedFilePath ? (
									<span className="text-muted-foreground text-xs">
										{previewQuery.data?.previewType === "image"
											? t("fileExplorer.imageMode")
											: t("fileExplorer.codeMode")}
									</span>
								) : null}
							</div>
							<div className="border-input bg-background flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-none border">
								{!selectedFilePath ? (
									<div className="text-muted-foreground flex flex-1 items-center justify-center px-3 text-xs">
										{t("fileExplorer.selectFileHint")}
									</div>
								) : previewQuery.isLoading ? (
									<div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs">
										<HugeiconsIcon
											icon={Loading03Icon}
											strokeWidth={2}
											className="animate-spin"
										/>
										{t("fileExplorer.loadingPreview")}
									</div>
								) : previewError ? (
									<div className="text-destructive flex flex-1 items-center justify-center px-3 text-xs">
										{previewError}
									</div>
								) : previewQuery.data && previewRenderer ? (
									previewRenderer(previewQuery.data)
								) : (
									<div className="text-muted-foreground flex flex-1 items-center justify-center px-3 text-xs">
										{t("fileExplorer.unsupportedFormat")}
									</div>
								)}
							</div>
						</div>
					</section>
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

