import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
	ColumnFileBrowser,
	useColumnFileBrowser,
} from "@/components/app/ColumnFileBrowser";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { type FsRootsResponse, fetchFsEntries, fetchFsRoots } from "@/lib/api";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { cn } from "@/lib/utils";

const HOME_LABEL_FALLBACK = "Home";

export type WorkingDirectoryPickerProps = {
	open: boolean;
	value: string | undefined;
	onChange: (nextPath: string) => void;
	onSelect?: (nextPath: string) => void;
	browserClassName?: string;
	inputId?: string;
	className?: string;
};

export function WorkingDirectoryPicker({
	open,
	value,
	onChange,
	onSelect,
	browserClassName,
	inputId = "session-cwd",
	className,
}: WorkingDirectoryPickerProps) {
	const [inputValue, setInputValue] = useState("");

	const rootsQuery = useQuery<FsRootsResponse>({
		queryKey: ["fs-roots"],
		queryFn: fetchFsRoots,
		enabled: open,
	});

	const homePath = rootsQuery.data?.homePath;
	const homeLabel = rootsQuery.data?.roots[0]?.name ?? HOME_LABEL_FALLBACK;

	const {
		columns,
		isLoading,
		pathError,
		buildColumnsForPath,
		handleEntrySelect,
		handleColumnSelect,
		scrollContainerRef,
		columnRefs,
	} = useColumnFileBrowser({
		open,
		rootPath: homePath,
		rootLabel: homeLabel,
		value,
		onChange,
		onSelect,
		fetchEntries: fetchFsEntries,
		errorMessage: "路径加载失败",
	});

	const handleSubmitPath = useCallback(() => {
		const nextPath = inputValue.trim();
		if (!nextPath) {
			return;
		}
		void buildColumnsForPath(nextPath, true);
	}, [buildColumnsForPath, inputValue]);

	useEffect(() => {
		if (!open) {
			setInputValue("");
			return;
		}
		if (!value) {
			return;
		}
		setInputValue(value);
	}, [open, value]);

	const rootsError = rootsQuery.isError
		? normalizeError(
				rootsQuery.error,
				createFallbackError("路径加载失败", "request"),
			).message
		: undefined;

	return (
		<div className={cn("flex min-w-0 flex-col gap-2", className)}>
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
			<ColumnFileBrowser
				columns={columns}
				currentPath={value}
				highlightedEntryPath={value}
				onColumnSelect={handleColumnSelect}
				onEntrySelect={handleEntrySelect}
				filterEntry={(entry) => entry.type === "directory"}
				emptyLabel="无子目录"
				isLoading={isLoading}
				scrollContainerRef={scrollContainerRef}
				columnRefs={columnRefs}
				className={cn("h-56 min-w-0 sm:h-64", browserClassName)}
			/>
		</div>
	);
}
