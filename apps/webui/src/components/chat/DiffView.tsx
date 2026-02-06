import type { Token } from "prism-react-renderer";
import { Highlight } from "prism-react-renderer";
import { useMemo } from "react";
import {
	getGruvboxTheme,
	normalizeCode,
	resolvePrismLanguage,
	useResolvedTheme,
} from "@/lib/code-highlight";
import { resolveLanguageFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

type UnifiedDiffViewProps = {
	diff: string;
	path: string;
	getLabel: (key: string, options?: Record<string, unknown>) => string;
	onOpenFilePreview?: (path: string) => void;
};

type DiffOp = {
	type: "equal" | "insert" | "delete";
	text: string;
};

type UnifiedDiffLine = {
	type: "context" | "added" | "removed" | "hunk";
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
};

const splitLines = (value: string) => value.split(/\r?\n/);

const buildDiffOps = (oldLines: string[], newLines: string[]): DiffOp[] => {
	const oldCount = oldLines.length;
	const newCount = newLines.length;
	if (oldCount === 0 && newCount === 0) {
		return [];
	}
	if (oldCount === 0) {
		return newLines.map((text) => ({ type: "insert", text }));
	}
	if (newCount === 0) {
		return oldLines.map((text) => ({ type: "delete", text }));
	}
	if (
		oldCount === newCount &&
		oldLines.every((line, index) => line === newLines[index])
	) {
		return oldLines.map((text) => ({ type: "equal", text }));
	}

	const max = oldCount + newCount;
	const offset = max;
	let current = new Array<number>(2 * max + 1).fill(0);
	const trace: number[][] = [];
	current[offset + 1] = 0;

	for (let depth = 0; depth <= max; depth += 1) {
		const next = current.slice();
		for (let k = -depth; k <= depth; k += 2) {
			let x: number;
			if (
				k === -depth ||
				(k !== depth && current[offset + k - 1] < current[offset + k + 1])
			) {
				x = current[offset + k + 1];
			} else {
				x = current[offset + k - 1] + 1;
			}
			let y = x - k;
			while (x < oldCount && y < newCount && oldLines[x] === newLines[y]) {
				x += 1;
				y += 1;
			}
			next[offset + k] = x;
			if (x >= oldCount && y >= newCount) {
				trace.push(next);
				return backtrackDiff(trace, oldLines, newLines, offset);
			}
		}
		trace.push(next);
		current = next;
	}
	return backtrackDiff(trace, oldLines, newLines, offset);
};

const backtrackDiff = (
	trace: number[][],
	oldLines: string[],
	newLines: string[],
	offset: number,
): DiffOp[] => {
	const ops: DiffOp[] = [];
	let x = oldLines.length;
	let y = newLines.length;
	for (let depth = trace.length - 1; depth >= 0; depth -= 1) {
		const v = trace[depth];
		const k = x - y;
		let prevK: number;
		if (
			k === -depth ||
			(k !== depth && v[offset + k - 1] < v[offset + k + 1])
		) {
			prevK = k + 1;
		} else {
			prevK = k - 1;
		}
		const prevX = v[offset + prevK];
		const prevY = prevX - prevK;

		while (x > prevX && y > prevY) {
			ops.push({ type: "equal", text: oldLines[x - 1] });
			x -= 1;
			y -= 1;
		}
		if (depth === 0) {
			break;
		}
		if (x === prevX) {
			ops.push({ type: "insert", text: newLines[y - 1] });
			y -= 1;
		} else {
			ops.push({ type: "delete", text: oldLines[x - 1] });
			x -= 1;
		}
	}
	return ops.reverse();
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
	let currentEnd = Math.min(
		ops.length - 1,
		changeIndices[0] + contextLines,
	);

	for (let i = 1; i < changeIndices.length; i++) {
		const nextStart = Math.max(0, changeIndices[i] - contextLines);
		const nextEnd = Math.min(
			ops.length - 1,
			changeIndices[i] + contextLines,
		);
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

/**
 * Parse unified diff format into structured lines
 */
const parseUnifiedDiff = (diff: string): UnifiedDiffLine[] => {
	const lines: UnifiedDiffLine[] = [];
	const rawLines = diff.split(/\r?\n/);

	let oldLine = 0;
	let newLine = 0;

	for (const raw of rawLines) {
		// Skip header lines: Index:, ===, ---, +++
		if (
			raw.startsWith("Index:") ||
			raw.startsWith("===") ||
			raw.startsWith("---") ||
			raw.startsWith("+++")
		) {
			continue;
		}

		// Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
		const hunkMatch = raw.match(
			/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
		);
		if (hunkMatch) {
			oldLine = Number.parseInt(hunkMatch[1], 10);
			newLine = Number.parseInt(hunkMatch[2], 10);
			lines.push({
				type: "hunk",
				content: raw,
			});
			continue;
		}

		// Added line
		if (raw.startsWith("+")) {
			lines.push({
				type: "added",
				content: raw.slice(1),
				newLineNum: newLine,
			});
			newLine += 1;
			continue;
		}

		// Removed line
		if (raw.startsWith("-")) {
			lines.push({
				type: "removed",
				content: raw.slice(1),
				oldLineNum: oldLine,
			});
			oldLine += 1;
			continue;
		}

		// Context line (starts with space or is empty in context)
		if (raw.startsWith(" ") || raw === "") {
			lines.push({
				type: "context",
				content: raw.startsWith(" ") ? raw.slice(1) : raw,
				oldLineNum: oldLine,
				newLineNum: newLine,
			});
			oldLine += 1;
			newLine += 1;
		}
	}

	return lines;
};

const unifiedLineTone = (type: UnifiedDiffLine["type"]) => {
	switch (type) {
		case "added":
			return "bg-emerald-500/10";
		case "removed":
			return "bg-destructive/10";
		case "hunk":
			return "bg-muted/50";
		default:
			return "";
	}
};

const unifiedIndicatorTone = (type: UnifiedDiffLine["type"]) => {
	switch (type) {
		case "added":
			return "text-emerald-600";
		case "removed":
			return "text-destructive";
		case "hunk":
			return "text-muted-foreground";
		default:
			return "text-muted-foreground";
	}
};

const getIndicatorChar = (type: UnifiedDiffLine["type"]) => {
	switch (type) {
		case "added":
			return "+";
		case "removed":
			return "-";
		case "hunk":
			return "@";
		default:
			return " ";
	}
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
		<div className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground">
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
			<div className="mt-2 rounded border border-border bg-muted/30">
				<Highlight code={code} language={language} theme={theme}>
					{({ tokens, getTokenProps, style }) => {
						const renderTokens = trimTrailingEmptyTokens(tokens, code);
						let tokenIndex = 0;

						return (
							<div
								className="max-h-56 overflow-auto"
								style={{ ...style, backgroundColor: "transparent" }}
							>
								{lines.map((line, lineIdx) => {
									// Hunk lines are rendered differently
									if (line.type === "hunk") {
										return (
											<div
												key={`hunk-${lineIdx}`}
												className={cn(
													"grid grid-cols-[minmax(2rem,auto)_minmax(2rem,auto)_1ch_1fr] gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
													unifiedLineTone(line.type),
												)}
											>
												<span className="text-right text-muted-foreground">
													...
												</span>
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
												<span className="whitespace-pre text-muted-foreground italic">
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
												"grid grid-cols-[minmax(2rem,auto)_minmax(2rem,auto)_1ch_1fr] gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
												unifiedLineTone(line.type),
											)}
										>
											<span className="text-right text-muted-foreground">
												{line.oldLineNum ?? ""}
											</span>
											<span className="text-right text-muted-foreground">
												{line.newLineNum ?? ""}
											</span>
											<span
												className={cn(
													"text-center",
													unifiedIndicatorTone(line.type),
												)}
											>
												{getIndicatorChar(line.type)}
											</span>
											<span className="whitespace-pre">
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
