import type { Token } from "prism-react-renderer";
import { Highlight } from "prism-react-renderer";
import { useMemo } from "react";
import {
	getGruvboxTheme,
	normalizeCode,
	resolvePrismLanguage,
	useResolvedTheme,
} from "@/lib/code-highlight";
import {
	buildDiffOps,
	getIndicatorChar,
	parseUnifiedDiff,
	splitLines,
	unifiedIndicatorTone,
	unifiedLineTone,
} from "@/lib/diff-utils";
import { resolveLanguageFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

type UnifiedDiffViewProps = {
	diff: string;
	path: string;
	getLabel: (key: string, options?: Record<string, unknown>) => string;
	onOpenFilePreview?: (path: string) => void;
	fullHeight?: boolean;
};

export const buildUnifiedDiffString = (
	oldText: string | null | undefined,
	newText: string,
	path = "",
	contextLines = 3,
): string => {
	const isNewFile = oldText === null || oldText === undefined;
	const oldSource = isNewFile ? "" : oldText;
	const oldLinesArr = isNewFile ? [] : splitLines(oldSource);
	const newLinesArr = splitLines(newText);
	const ops = buildDiffOps(oldLinesArr, newLinesArr);

	const hasChanges = ops.some((op) => op.type !== "equal");
	if (!hasChanges) {
		return "";
	}

	// Find indices of changed ops
	const changeIndices: number[] = [];
	for (let i = 0; i < ops.length; i++) {
		if (ops[i].type !== "equal") {
			changeIndices.push(i);
		}
	}

	// Group change indices into hunk ranges with context
	type HunkRange = { start: number; end: number };
	const hunkRanges: HunkRange[] = [];
	let currentStart = Math.max(0, changeIndices[0] - contextLines);
	let currentEnd = Math.min(ops.length - 1, changeIndices[0] + contextLines);

	for (let i = 1; i < changeIndices.length; i++) {
		const nextStart = Math.max(0, changeIndices[i] - contextLines);
		const nextEnd = Math.min(ops.length - 1, changeIndices[i] + contextLines);
		if (nextStart <= currentEnd + 1) {
			currentEnd = nextEnd;
		} else {
			hunkRanges.push({ start: currentStart, end: currentEnd });
			currentStart = nextStart;
			currentEnd = nextEnd;
		}
	}
	hunkRanges.push({ start: currentStart, end: currentEnd });

	// Build output lines
	const output: string[] = [];
	output.push(`--- a/${path}`);
	output.push(`+++ b/${path}`);

	for (const range of hunkRanges) {
		// Compute line numbers for the hunk header
		let oldStart = 1;
		let newStart = 1;
		for (let i = 0; i < range.start; i++) {
			if (ops[i].type === "equal" || ops[i].type === "delete") {
				oldStart += 1;
			}
			if (ops[i].type === "equal" || ops[i].type === "insert") {
				newStart += 1;
			}
		}

		let oldCount = 0;
		let newCount = 0;
		const hunkLines: string[] = [];

		for (let i = range.start; i <= range.end; i++) {
			const op = ops[i];
			switch (op.type) {
				case "equal":
					hunkLines.push(` ${op.text}`);
					oldCount += 1;
					newCount += 1;
					break;
				case "delete":
					hunkLines.push(`-${op.text}`);
					oldCount += 1;
					break;
				case "insert":
					hunkLines.push(`+${op.text}`);
					newCount += 1;
					break;
			}
		}

		output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
		output.push(...hunkLines);
	}

	return output.join("\n");
};

const trimTrailingEmptyTokens = (tokens: Token[][], code: string) => {
	if (!code.endsWith("\n") || tokens.length === 0) {
		return tokens;
	}
	const lastLine = tokens[tokens.length - 1];
	if (lastLine && lastLine.every((token) => token.content === "")) {
		return tokens.slice(0, -1);
	}
	return tokens;
};

const resolveFileName = (pathValue: string) => {
	const parts = pathValue.split(/[/\\]/).filter(Boolean);
	return parts.at(-1) ?? pathValue;
};

export const UnifiedDiffView = ({
	diff,
	path,
	getLabel,
	onOpenFilePreview,
	fullHeight,
}: UnifiedDiffViewProps) => {
	const themeMode = useResolvedTheme();
	const theme = getGruvboxTheme(themeMode);
	const lines = useMemo(() => parseUnifiedDiff(diff), [diff]);
	const language = useMemo(
		() => resolvePrismLanguage(resolveLanguageFromPath(path)),
		[path],
	);
	const label = useMemo(() => resolveFileName(path), [path]);

	// Build code string for syntax highlighting (excluding hunks)
	const codeLines = useMemo(
		() => lines.filter((l) => l.type !== "hunk").map((l) => l.content),
		[lines],
	);
	const code = useMemo(() => normalizeCode(codeLines.join("\n")), [codeLines]);

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
						className="text-xs text-primary hover:underline"
						onClick={(event) => {
							event.preventDefault();
							onOpenFilePreview(path);
						}}
					>
						{label}
					</button>
				) : (
					<span className="text-xs text-foreground">{label}</span>
				)}
			</div>
			<div
				className={cn(
					"mt-2 rounded border border-border bg-muted/30",
					fullHeight && "min-h-0 flex-1 overflow-hidden",
				)}
			>
				<Highlight code={code} language={language} theme={theme}>
					{({ tokens, getTokenProps, style }) => {
						const renderTokens = trimTrailingEmptyTokens(tokens, code);
						let tokenIndex = 0;

						return (
							<div
								className={cn(
									"overflow-auto",
									fullHeight ? "h-full" : "max-h-56",
								)}
								style={{ ...style, backgroundColor: "transparent" }}
							>
								{lines.map((line, lineIdx) => {
									// Hunk lines are rendered differently
									if (line.type === "hunk") {
										return (
											<div
												key={`hunk-${lineIdx}`}
												className={cn(
													"grid grid-cols-[minmax(2rem,auto)_1ch_1fr] items-start gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
													unifiedLineTone(line.type),
												)}
											>
												<span className="text-right text-muted-foreground">
													...
												</span>
												<span
													className={cn(
														"text-center",
														unifiedIndicatorTone(line.type),
													)}
												>
													{getIndicatorChar(line.type)}
												</span>
												<span className="whitespace-pre-wrap break-words text-muted-foreground italic">
													{line.content.replace(/^@@.*@@/, "").trim() ||
														line.content}
												</span>
											</div>
										);
									}

									const tokenLine = renderTokens[tokenIndex];
									tokenIndex += 1;

									return (
										<div
											key={`line-${lineIdx}`}
											className={cn(
												"grid grid-cols-[minmax(2rem,auto)_1ch_1fr] items-start gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
												unifiedLineTone(line.type),
											)}
										>
											<span className="text-right text-muted-foreground">
												{line.type === "removed"
													? line.oldLineNum
													: line.newLineNum}
											</span>
											<span
												className={cn(
													"text-center",
													unifiedIndicatorTone(line.type),
												)}
											>
												{getIndicatorChar(line.type)}
											</span>
											<span className="whitespace-pre-wrap break-words">
												{tokenLine
													? tokenLine.map((token, tIdx) => (
															<span
																key={`token-${lineIdx}-${tIdx}`}
																{...getTokenProps({ token, key: tIdx })}
															/>
														))
													: line.content.length > 0
														? line.content
														: " "}
											</span>
										</div>
									);
								})}
							</div>
						);
					}}
				</Highlight>
			</div>
		</div>
	);
};
