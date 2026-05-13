import { parsePatchFiles } from "@pierre/diffs";
import {
	type FileContents,
	FileDiff,
	type FileDiffMetadata,
	type FileDiffProps,
	MultiFileDiff,
	type SupportedLanguages,
} from "@pierre/diffs/react";
import { useMemo } from "react";
import { useResolvedTheme } from "@/lib/code-highlight";
import {
	resolveFileNameFromPath,
	resolveLanguageFromPath,
} from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

type DiffOptions = NonNullable<FileDiffProps<undefined>["options"]>;

type UnifiedDiffViewProps = {
	path: string;
	getLabel: (key: string, options?: Record<string, unknown>) => string;
	onOpenFilePreview?: (path: string) => void;
	fullHeight?: boolean;
} & (
	| {
			diff: string;
			oldText?: never;
			newText?: never;
	  }
	| {
			diff?: never;
			oldText: string | null | undefined;
			newText: string;
	  }
);

const buildPierreDiffOptions = (themeType: "light" | "dark"): DiffOptions => ({
	theme: {
		light: "gruvbox-light-medium",
		dark: "gruvbox-dark-medium",
	},
	themeType,
	diffStyle: "unified",
	diffIndicators: "bars",
	lineDiffType: "word-alt",
	disableBackground: false,
	overflow: "wrap",
	disableLineNumbers: false,
});

const normalizeDiffFileName = (path: string) =>
	path.replace(/^(?:a|b)\//, "") || path;

const flattenPatchFiles = (diff: string): FileDiffMetadata[] =>
	parsePatchFiles(diff)
		.flatMap((patch) => patch.files)
		.map((fileDiff) => ({
			...fileDiff,
			name: normalizeDiffFileName(fileDiff.name),
			prevName: fileDiff.prevName
				? normalizeDiffFileName(fileDiff.prevName)
				: fileDiff.prevName,
		}));

const createFileContents = (
	path: string,
	contents: string,
	cacheKey: string,
): FileContents => ({
	name: path || "diff",
	contents,
	cacheKey,
	lang: resolveLanguageFromPath(path) as SupportedLanguages,
});

export const UnifiedDiffView = (props: UnifiedDiffViewProps) => {
	const { path, getLabel, onOpenFilePreview, fullHeight } = props;
	const isContentDiff = "newText" in props;
	const diff = props.diff;
	const oldText = "oldText" in props ? props.oldText : undefined;
	const newText = props.newText;
	const themeMode = useResolvedTheme();
	const options = useMemo(() => buildPierreDiffOptions(themeMode), [themeMode]);
	const label = useMemo(() => resolveFileNameFromPath(path), [path]);
	const parsedFiles = useMemo(
		() => (diff !== undefined ? flattenPatchFiles(diff) : []),
		[diff],
	);
	const oldFile = useMemo(
		() =>
			isContentDiff
				? createFileContents(path, oldText ?? "", `old:${path}`)
				: null,
		[isContentDiff, oldText, path],
	);
	const newFile = useMemo(
		() =>
			isContentDiff
				? createFileContents(path, newText ?? "", `new:${path}`)
				: null,
		[isContentDiff, newText, path],
	);

	if (isContentDiff && (oldText ?? "") === newText) {
		return null;
	}

	const diffBody =
		oldFile && newFile ? (
			<MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} />
		) : parsedFiles.length > 0 ? (
			parsedFiles.map((fileDiff, index) => (
				<FileDiff
					key={`${fileDiff.name}-${index}`}
					fileDiff={fileDiff}
					options={options}
				/>
			))
		) : null;

	if (!diffBody) {
		return null;
	}

	return (
		<div
			className={cn(
				"rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground",
				fullHeight && "flex min-h-0 flex-1 flex-col",
			)}
		>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span>{getLabel("toolCall.changes")}</span>
				{onOpenFilePreview ? (
					<button
						type="button"
						className="min-w-0 max-w-full break-all rounded text-left text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
						onClick={(event) => {
							event.preventDefault();
							onOpenFilePreview(path);
						}}
					>
						{label}
					</button>
				) : (
					<span className="min-w-0 max-w-full break-all text-xs text-foreground">
						{label}
					</span>
				)}
			</div>
			<div
				className={cn(
					"mt-2 rounded border border-border bg-muted/30 [&_pre]:whitespace-pre-wrap [&_pre]:break-words",
					fullHeight
						? "min-h-0 flex-1 overflow-auto"
						: "max-h-56 overflow-auto",
				)}
			>
				{diffBody}
			</div>
		</div>
	);
};
