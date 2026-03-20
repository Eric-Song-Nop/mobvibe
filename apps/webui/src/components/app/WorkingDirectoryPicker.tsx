import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ColumnFileBrowser,
	useColumnFileBrowser,
} from "@/components/app/ColumnFileBrowser";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	fetchFsEntries,
	fetchFsRoots,
	type HostFsRootsResponse,
} from "@/lib/api";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { findBestMatchingRoot, isPathAtRoot } from "@/lib/path-utils";
import { cn } from "@/lib/utils";

const HOME_LABEL_FALLBACK = "Home";

const resolveActiveRoot = (
	roots: HostFsRootsResponse["roots"],
	value: string | undefined,
	homePath: string | undefined,
) =>
	findBestMatchingRoot(roots, value) ??
	roots.find((root) => homePath && isPathAtRoot(root.path, homePath)) ??
	roots[0];

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
	const [activeRootPath, setActiveRootPath] = useState<string | undefined>();
	const pendingBuildRef = useRef<
		| {
				targetPath: string;
				notifySelect: boolean;
				rootPath: string;
		  }
		| undefined
	>(undefined);

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

	const roots = rootsQuery.data?.roots ?? [];
	const homePath = rootsQuery.data?.homePath;
	const homeLabel =
		roots.find((root) => homePath && isPathAtRoot(root.path, homePath))?.name ??
		t("workingDirectory.homeLabel", {
			defaultValue: HOME_LABEL_FALLBACK,
		});
	const matchedActiveRoot = roots.find((root) => root.path === activeRootPath);
	const activeRoot =
		matchedActiveRoot ?? resolveActiveRoot(roots, value, homePath);
	const resolvedActiveRootPath = activeRoot?.path;
	const resolvedActiveRootLabel = activeRoot?.name ?? homeLabel;

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
		rootPath: resolvedActiveRootPath,
		rootLabel: resolvedActiveRootLabel,
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
		const nextRoot = findBestMatchingRoot(roots, nextPath);
		if (nextRoot && nextRoot.path !== resolvedActiveRootPath) {
			pendingBuildRef.current = {
				targetPath: nextPath,
				notifySelect: true,
				rootPath: nextRoot.path,
			};
			setActiveRootPath(nextRoot.path);
			return;
		}
		void buildColumnsForPath(nextPath, true);
	}, [buildColumnsForPath, inputValue, resolvedActiveRootPath, roots]);

	const handleRootClick = useCallback(
		(rootPath: string) => {
			onChange(rootPath);
			setInputValue(rootPath);
			if (rootPath === resolvedActiveRootPath) {
				void buildColumnsForPath(rootPath, true);
				return;
			}
			pendingBuildRef.current = {
				targetPath: rootPath,
				notifySelect: true,
				rootPath,
			};
			setActiveRootPath(rootPath);
		},
		[buildColumnsForPath, onChange, resolvedActiveRootPath],
	);

	useEffect(() => {
		if (!open) {
			setInputValue("");
			setActiveRootPath(undefined);
			pendingBuildRef.current = undefined;
			return;
		}
		if (!value) {
			return;
		}
		setInputValue(value);
	}, [open, value]);

	useEffect(() => {
		if (!open || roots.length === 0) {
			return;
		}
		const nextActiveRoot = resolveActiveRoot(roots, value, homePath);
		if (!nextActiveRoot) {
			return;
		}
		setActiveRootPath((currentPath) =>
			currentPath === nextActiveRoot.path ? currentPath : nextActiveRoot.path,
		);
	}, [homePath, open, roots, value]);

	useEffect(() => {
		if (!open || !resolvedActiveRootPath) {
			return;
		}
		const pendingBuild = pendingBuildRef.current;
		if (!pendingBuild || pendingBuild.rootPath !== resolvedActiveRootPath) {
			return;
		}
		pendingBuildRef.current = undefined;
		void buildColumnsForPath(
			pendingBuild.targetPath,
			pendingBuild.notifySelect,
		);
	}, [buildColumnsForPath, open, resolvedActiveRootPath]);

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
			{roots.length > 1 ? (
				<div className="flex flex-wrap gap-1">
					{roots.map((root) => {
						const isActive = root.path === resolvedActiveRootPath;
						return (
							<Button
								key={root.path}
								type="button"
								variant={isActive ? "secondary" : "outline"}
								size="xs"
								aria-pressed={isActive}
								onClick={() => handleRootClick(root.path)}
							>
								{root.name}
							</Button>
						);
					})}
				</div>
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
