import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ColumnFileBrowser,
	useColumnFileBrowser,
} from "@/components/app/ColumnFileBrowser";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	fetchFsEntries,
	fetchFsRoots,
	type HostFsRootsResponse,
} from "@/lib/api";
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
	machineId?: string;
};

export function WorkingDirectoryPicker({
	open,
	value,
	onChange,
	onSelect,
	browserClassName,
	inputId = "session-cwd",
	className,
	machineId,
}: WorkingDirectoryPickerProps) {
	const { t } = useTranslation();
	const [inputValue, setInputValue] = useState("");

	const rootsQuery = useQuery<HostFsRootsResponse>({
		queryKey: ["fs-roots", machineId],
		queryFn: () => {
			if (!machineId) {
				throw createFallbackError(t("errors.selectMachine"), "request");
			}
			return fetchFsRoots({ machineId });
		},
		enabled: open && Boolean(machineId),
	});

	const homePath = rootsQuery.data?.homePath;
	const homeLabel =
		rootsQuery.data?.roots[0]?.name ??
		t("workingDirectory.homeLabel", {
			defaultValue: HOME_LABEL_FALLBACK,
		});

	const fetchEntries = useCallback(
		async (payload: { path: string }) => {
			if (!machineId) {
				throw createFallbackError(t("errors.selectMachine"), "request");
			}
			return fetchFsEntries({ path: payload.path, machineId });
		},
		[machineId, t],
	);

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
		fetchEntries,
		errorMessage: t("errors.pathLoadFailed"),
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

	const machineError =
		open && !machineId ? t("errors.selectMachine") : undefined;
	const rootsError = rootsQuery.isError
		? normalizeError(
				rootsQuery.error,
				createFallbackError(t("errors.pathLoadFailed"), "request"),
			).message
		: undefined;

	return (
		<div className={cn("flex min-w-0 flex-col gap-2", className)}>
			<Label htmlFor={inputId}>{t("session.cwdLabel")}</Label>
			<InputGroup>
				<InputGroupInput
					id={inputId}
					name="working-directory"
					autoComplete="off"
					value={inputValue}
					onChange={(event) => setInputValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							handleSubmitPath();
						}
					}}
					placeholder={t("session.cwdPlaceholder")}
					disabled={!open || rootsQuery.isLoading}
				/>
			</InputGroup>
			{machineError ? (
				<div className="text-destructive text-xs">{machineError}</div>
			) : null}
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
				emptyLabel={t("workingDirectory.emptyDirectory")}
				isLoading={isLoading}
				scrollContainerRef={scrollContainerRef}
				columnRefs={columnRefs}
				className={cn("h-56 min-w-0 sm:h-64", browserClassName)}
			/>
		</div>
	);
}
