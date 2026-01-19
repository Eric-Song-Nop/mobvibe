import {
	File01Icon,
	FolderIcon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { FsEntriesResponse, FsEntry } from "@/lib/api";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { cn } from "@/lib/utils";

const normalizePath = (value: string) => value.replace(/\/+$/, "");

type PathSegment = {
	name: string;
	path: string;
};

const buildPathSegments = (
	rootPath: string,
	targetPath: string,
	rootLabel: string,
): PathSegment[] => {
	const normalizedRoot = normalizePath(rootPath);
	const normalizedTarget = normalizePath(targetPath);
	const segments: PathSegment[] = [{ name: rootLabel, path: normalizedRoot }];
	if (normalizedTarget === normalizedRoot) {
		return segments;
	}
	if (!normalizedTarget.startsWith(`${normalizedRoot}/`)) {
		return segments;
	}
	const relative = normalizedTarget.slice(normalizedRoot.length + 1);
	const parts = relative.split("/").filter(Boolean);
	let currentPath = normalizedRoot;
	parts.forEach((part) => {
		currentPath = `${currentPath}/${part}`;
		segments.push({ name: part, path: currentPath });
	});
	return segments;
};

export type ColumnFileBrowserColumn = {
	name: string;
	path: string;
	entries: FsEntry[];
};

export type UseColumnFileBrowserOptions = {
	open: boolean;
	rootPath?: string;
	rootLabel: string;
	value: string | undefined;
	onChange: (nextPath: string) => void;
	onSelect?: (nextPath: string) => void;
	onFileSelect?: (entry: FsEntry) => void;
	fetchEntries: (payload: { path: string }) => Promise<FsEntriesResponse>;
	errorMessage: string;
};

export type ColumnFileBrowserState = {
	columns: ColumnFileBrowserColumn[];
	isLoading: boolean;
	pathError?: string;
	buildColumnsForPath: (
		targetPath: string,
		notifySelect?: boolean,
	) => Promise<void>;
	handleEntrySelect: (entry: FsEntry, columnIndex: number) => Promise<void>;
	handleColumnSelect: (columnIndex: number) => void;
	scrollContainerRef: React.RefObject<HTMLDivElement | null>;
	columnRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
};

export function useColumnFileBrowser({
	open,
	rootPath,
	rootLabel,
	value,
	onChange,
	onSelect,
	onFileSelect,
	fetchEntries,
	errorMessage,
}: UseColumnFileBrowserOptions): ColumnFileBrowserState {
	const [columns, setColumns] = useState<ColumnFileBrowserColumn[]>([]);
	const [pathError, setPathError] = useState<string | undefined>();
	const [isLoading, setIsLoading] = useState(false);
	const [initialized, setInitialized] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const previousRootRef = useRef<string | undefined>(undefined);

	const normalizeErrorMessage = useCallback(
		(error: unknown) =>
			normalizeError(error, createFallbackError(errorMessage, "request"))
				.message,
		[errorMessage],
	);

	const buildColumnsForPath = useCallback(
		async (targetPath: string, notifySelect = false) => {
			if (!rootPath) {
				return;
			}
			setIsLoading(true);
			setPathError(undefined);
			try {
				const targetResponse = await fetchEntries({ path: targetPath });
				const segments = buildPathSegments(
					rootPath,
					targetResponse.path,
					rootLabel,
				);
				const responses = await Promise.all(
					segments.map((segment) =>
						segment.path === targetResponse.path
							? Promise.resolve(targetResponse)
							: fetchEntries({ path: segment.path }),
					),
				);
				const nextColumns = segments.map((segment, index) => ({
					name: segment.name,
					path: responses[index].path,
					entries: responses[index].entries,
				}));
				setColumns(nextColumns);
				if (targetResponse.path !== value) {
					onChange(targetResponse.path);
				}
				if (notifySelect) {
					onSelect?.(targetResponse.path);
				}
			} catch (error) {
				setPathError(normalizeErrorMessage(error));
			} finally {
				setIsLoading(false);
			}
		},
		[
			fetchEntries,
			normalizeErrorMessage,
			onChange,
			onSelect,
			rootLabel,
			rootPath,
			value,
		],
	);

	const handleEntrySelect = useCallback(
		async (entry: FsEntry, columnIndex: number) => {
			if (entry.type === "file") {
				onFileSelect?.(entry);
				return;
			}
			setIsLoading(true);
			setPathError(undefined);
			try {
				const response = await fetchEntries({ path: entry.path });
				const nextColumns = columns.slice(0, columnIndex + 1);
				nextColumns.push({
					name: entry.name,
					path: response.path,
					entries: response.entries,
				});
				setColumns(nextColumns);
				if (response.path !== value) {
					onChange(response.path);
				}
				onSelect?.(response.path);
			} catch (error) {
				setPathError(normalizeErrorMessage(error));
			} finally {
				setIsLoading(false);
			}
		},
		[
			columns,
			fetchEntries,
			normalizeErrorMessage,
			onChange,
			onFileSelect,
			onSelect,
			value,
		],
	);

	const handleColumnSelect = useCallback(
		(columnIndex: number) => {
			const column = columns[columnIndex];
			if (!column) {
				return;
			}
			setColumns(columns.slice(0, columnIndex + 1));
			setPathError(undefined);
			if (column.path !== value) {
				onChange(column.path);
			}
			onSelect?.(column.path);
		},
		[columns, onChange, onSelect, value],
	);

	useLayoutEffect(() => {
		const container = scrollContainerRef.current;
		const targetPath = value ?? columns[columns.length - 1]?.path;
		if (!container || !targetPath) {
			return;
		}
		const targetColumn = columnRefs.current[targetPath];
		if (!targetColumn) {
			return;
		}
		const maxScrollLeft = container.scrollWidth - container.clientWidth;
		const nextScrollLeft =
			targetColumn.offsetLeft -
			(container.clientWidth - targetColumn.offsetWidth) / 2;
		const clampedScroll = Math.max(0, Math.min(nextScrollLeft, maxScrollLeft));
		container.scrollLeft = clampedScroll;
	}, [columns, value]);

	useEffect(() => {
		const reset = () => {
			setColumns([]);
			setPathError(undefined);
			setIsLoading(false);
			setInitialized(false);
			columnRefs.current = {};
		};

		if (!open || !rootPath) {
			reset();
			previousRootRef.current = rootPath;
			return;
		}

		if (previousRootRef.current && previousRootRef.current !== rootPath) {
			reset();
		}

		previousRootRef.current = rootPath;
	}, [open, rootPath]);

	useEffect(() => {
		if (!open) {
			return;
		}
		if (!rootPath || initialized) {
			return;
		}
		const initialPath = value ?? rootPath;
		void buildColumnsForPath(initialPath);
		setInitialized(true);
	}, [buildColumnsForPath, initialized, open, rootPath, value]);

	return {
		columns,
		isLoading,
		pathError,
		buildColumnsForPath,
		handleEntrySelect,
		handleColumnSelect,
		scrollContainerRef,
		columnRefs,
	};
}

export type ColumnFileBrowserProps = {
	columns: ColumnFileBrowserColumn[];
	currentPath?: string;
	highlightedEntryPath?: string;
	isLoading?: boolean;
	emptyLabel?: string;
	onColumnSelect: (columnIndex: number) => void;
	onEntrySelect: (entry: FsEntry, columnIndex: number) => void;
	filterEntry?: (entry: FsEntry) => boolean;
	className?: string;
	scrollContainerRef: React.RefObject<HTMLDivElement | null>;
	columnRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
};

export function ColumnFileBrowser({
	columns,
	currentPath,
	highlightedEntryPath,
	isLoading = false,
	emptyLabel,
	onColumnSelect,
	onEntrySelect,
	filterEntry,
	className,
	scrollContainerRef,
	columnRefs,
}: ColumnFileBrowserProps) {
	const { t } = useTranslation();
	const resolvedEmptyLabel = emptyLabel ?? t("fileBrowser.empty");

	return (
		<div
			className={cn(
				"border-input bg-muted/30 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-none border p-2",
				className,
			)}
		>
			<div
				ref={scrollContainerRef}
				className="min-h-0 flex-1 w-full overflow-x-auto overflow-y-hidden"
			>
				<div className="flex h-full w-max flex-nowrap gap-3 pr-2">
					{columns.map((column, columnIndex) => {
						const isColumnSelected = column.path === currentPath;
						const entries = filterEntry
							? column.entries.filter(filterEntry)
							: column.entries;
						return (
							<div
								key={column.path}
								ref={(node) => {
									if (node) {
										columnRefs.current[column.path] = node;
										return;
									}
									delete columnRefs.current[column.path];
								}}
								className="border-input bg-background/80 flex h-full min-h-0 min-w-[12rem] shrink-0 flex-col rounded-none border"
							>
								<button
									type="button"
									className={cn(
										"text-muted-foreground border-input flex shrink-0 items-center gap-2 border-b px-2 py-1 text-xs",
										isColumnSelected && "bg-muted text-foreground",
									)}
									onClick={() => onColumnSelect(columnIndex)}
								>
									<HugeiconsIcon icon={FolderIcon} strokeWidth={2} />
									<span className="truncate">{column.name}</span>
								</button>
								<div className="flex min-h-0 flex-col overflow-y-auto">
									{entries.length === 0 ? (
										<div className="text-muted-foreground px-2 py-3 text-xs">
											{resolvedEmptyLabel}
										</div>
									) : (
										entries.map((entry) => {
											const isSelected =
												entry.path === (highlightedEntryPath ?? currentPath);
											const icon =
												entry.type === "directory" ? FolderIcon : File01Icon;
											return (
												<button
													key={entry.path}
													type="button"
													className={cn(
														"hover:bg-muted flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs",
														isSelected && "bg-muted",
													)}
													onClick={() => onEntrySelect(entry, columnIndex)}
												>
													<HugeiconsIcon
														icon={icon}
														strokeWidth={2}
														className="shrink-0"
													/>
													<span className="truncate">{entry.name}</span>
												</button>
											);
										})
									)}
								</div>
							</div>
						);
					})}
					{isLoading ? (
						<div className="text-muted-foreground flex h-full min-w-[9rem] shrink-0 items-center gap-2 px-2 text-xs">
							<HugeiconsIcon
								icon={Loading03Icon}
								strokeWidth={2}
								className="animate-spin"
							/>
							{t("fileBrowser.loading")}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
