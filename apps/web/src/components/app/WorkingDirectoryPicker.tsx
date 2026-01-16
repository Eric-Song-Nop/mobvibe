import { FolderIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	type FsEntry,
	type FsRootsResponse,
	fetchFsEntries,
	fetchFsRoots,
} from "@/lib/api";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { cn } from "@/lib/utils";

const HOME_LABEL_FALLBACK = "Home";

type DirectoryColumn = {
	name: string;
	path: string;
	entries: FsEntry[];
};

type PathSegment = {
	name: string;
	path: string;
};

const normalizePath = (value: string) => value.replace(/\/+$/, "");

const buildPathSegments = (
	homePath: string,
	targetPath: string,
	homeLabel: string,
): PathSegment[] => {
	const normalizedHome = normalizePath(homePath);
	const normalizedTarget = normalizePath(targetPath);
	const segments: PathSegment[] = [{ name: homeLabel, path: normalizedHome }];
	if (normalizedTarget === normalizedHome) {
		return segments;
	}
	if (!normalizedTarget.startsWith(`${normalizedHome}/`)) {
		return segments;
	}
	const relative = normalizedTarget.slice(normalizedHome.length + 1);
	const parts = relative.split("/").filter(Boolean);
	let currentPath = normalizedHome;
	parts.forEach((part) => {
		currentPath = `${currentPath}/${part}`;
		segments.push({ name: part, path: currentPath });
	});
	return segments;
};

export type WorkingDirectoryPickerProps = {
	open: boolean;
	value: string | undefined;
	onChange: (nextPath: string) => void;
	onSelect?: (nextPath: string) => void;
	browserClassName?: string;
	inputId?: string;
};

export function WorkingDirectoryPicker({
	open,
	value,
	onChange,
	onSelect,
	browserClassName,
	inputId = "session-cwd",
}: WorkingDirectoryPickerProps) {
	const [columns, setColumns] = useState<DirectoryColumn[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [pathError, setPathError] = useState<string | undefined>();
	const [isLoading, setIsLoading] = useState(false);
	const [initialized, setInitialized] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

	const rootsQuery = useQuery<FsRootsResponse>({
		queryKey: ["fs-roots"],
		queryFn: fetchFsRoots,
		enabled: open,
	});

	const homePath = rootsQuery.data?.homePath;
	const homeLabel = rootsQuery.data?.roots[0]?.name ?? HOME_LABEL_FALLBACK;

	const normalizeErrorMessage = useCallback((error: unknown) => {
		const detail = normalizeError(
			error,
			createFallbackError("路径加载失败", "request"),
		);
		return detail.message;
	}, []);

	const resetState = useCallback(() => {
		setColumns([]);
		setInputValue("");
		setPathError(undefined);
		setIsLoading(false);
		setInitialized(false);
	}, []);

	const buildColumnsForPath = useCallback(
		async (targetPath: string, notifySelect = false) => {
			if (!homePath) {
				return;
			}
			setIsLoading(true);
			setPathError(undefined);
			try {
				const targetResponse = await fetchFsEntries({ path: targetPath });
				const segments = buildPathSegments(
					homePath,
					targetResponse.path,
					homeLabel,
				);
				const responses = await Promise.all(
					segments.map((segment) =>
						segment.path === targetResponse.path
							? Promise.resolve(targetResponse)
							: fetchFsEntries({ path: segment.path }),
					),
				);
				const nextColumns = segments.map((segment, index) => ({
					name: segment.name,
					path: responses[index].path,
					entries: responses[index].entries,
				}));
				setColumns(nextColumns);
				setInputValue(targetResponse.path);
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
		[homeLabel, homePath, normalizeErrorMessage, onChange, onSelect, value],
	);

	const handleSubmitPath = useCallback(() => {
		const nextPath = inputValue.trim();
		if (!nextPath) {
			return;
		}
		void buildColumnsForPath(nextPath, true);
	}, [buildColumnsForPath, inputValue]);

	const handleEntrySelect = useCallback(
		async (entry: FsEntry, columnIndex: number) => {
			if (entry.type !== "directory") {
				return;
			}
			setIsLoading(true);
			setPathError(undefined);
			try {
				const response = await fetchFsEntries({ path: entry.path });
				const nextColumns = columns.slice(0, columnIndex + 1);
				nextColumns.push({
					name: entry.name,
					path: response.path,
					entries: response.entries,
				});
				setColumns(nextColumns);
				setInputValue(response.path);
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
		[columns, normalizeErrorMessage, onChange, onSelect, value],
	);

	const handleColumnSelect = useCallback(
		(columnIndex: number) => {
			const column = columns[columnIndex];
			if (!column) {
				return;
			}
			setColumns(columns.slice(0, columnIndex + 1));
			setInputValue(column.path);
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
		if (!open) {
			resetState();
			return;
		}
		if (!homePath || initialized) {
			return;
		}
		const initialPath = value ?? homePath;
		void buildColumnsForPath(initialPath);
		setInitialized(true);
	}, [buildColumnsForPath, homePath, initialized, open, resetState, value]);

	useEffect(() => {
		if (!open) {
			return;
		}
		if (!value) {
			return;
		}
		setInputValue(value);
	}, [open, value]);

	const rootsError = rootsQuery.isError
		? normalizeErrorMessage(rootsQuery.error)
		: undefined;

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<Label htmlFor={inputId}>工作目录</Label>
			<InputGroup>
				<InputGroupInput
					id={inputId}
					value={inputValue}
					onChange={(event) => setInputValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							handleSubmitPath();
						}
					}}
					placeholder="输入或粘贴 Home 内路径"
					disabled={!open || rootsQuery.isLoading}
				/>
			</InputGroup>
			{rootsError ? (
				<div className="text-destructive text-xs">{rootsError}</div>
			) : null}
			{pathError ? (
				<div className="text-destructive text-xs">{pathError}</div>
			) : null}
			<div
				className={cn(
					"border-input bg-muted/30 h-56 min-w-0 overflow-hidden rounded-none border p-2 sm:h-64",
					browserClassName,
				)}
			>
				<div
					ref={scrollContainerRef}
					className="h-full w-full overflow-x-auto overflow-y-hidden"
				>
					<div className="flex h-full w-max flex-nowrap gap-3 pr-2">
						{columns.map((column, columnIndex) => {
							const isColumnSelected = column.path === value;
							const directoryEntries = column.entries.filter(
								(entry) => entry.type === "directory",
							);
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
										onClick={() => handleColumnSelect(columnIndex)}
									>
										<HugeiconsIcon icon={FolderIcon} strokeWidth={2} />
										<span className="truncate">{column.name}</span>
									</button>
									<div className="flex min-h-0 flex-col overflow-y-auto">
										{directoryEntries.length === 0 ? (
											<div className="text-muted-foreground px-2 py-3 text-xs">
												无子目录
											</div>
										) : (
											directoryEntries.map((entry) => {
												const isSelected = entry.path === value;
												return (
													<button
														key={entry.path}
														type="button"
														className={cn(
															"hover:bg-muted flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs",
															isSelected && "bg-muted",
														)}
														onClick={() =>
															handleEntrySelect(entry, columnIndex)
														}
													>
														<HugeiconsIcon
															icon={FolderIcon}
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
								加载中...
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
