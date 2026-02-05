import type { Language, Token } from "prism-react-renderer";
import { Highlight } from "prism-react-renderer";
import type { RefObject, UIEvent } from "react";
import { useMemo, useRef } from "react";
import {
	getGruvboxTheme,
	normalizeCode,
	useResolvedTheme,
} from "@/lib/code-highlight";
import { resolveLanguageFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

type DiffViewProps = {
	path: string;
	label: string;
	oldText?: string | null;
	newText: string;
	getLabel: (key: string, options?: Record<string, unknown>) => string;
	onOpenFilePreview?: (path: string) => void;
};

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

type DiffLine = {
	lineNumber: number;
	text: string;
	variant: "unchanged" | "added" | "removed";
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

const buildDiffLines = (ops: DiffOp[]) => {
	const oldLines: DiffLine[] = [];
	const newLines: DiffLine[] = [];
	let oldNumber = 1;
	let newNumber = 1;
	ops.forEach((op) => {
		switch (op.type) {
			case "equal":
				oldLines.push({
					lineNumber: oldNumber,
					text: op.text,
					variant: "unchanged",
				});
				newLines.push({
					lineNumber: newNumber,
					text: op.text,
					variant: "unchanged",
				});
				oldNumber += 1;
				newNumber += 1;
				break;
			case "delete":
				oldLines.push({
					lineNumber: oldNumber,
					text: op.text,
					variant: "removed",
				});
				oldNumber += 1;
				break;
			case "insert":
				newLines.push({
					lineNumber: newNumber,
					text: op.text,
					variant: "added",
				});
				newNumber += 1;
				break;
			default:
				break;
		}
	});
	return { oldLines, newLines };
};

const lineTone = (variant: DiffLine["variant"]) => {
	switch (variant) {
		case "added":
			return "bg-emerald-500/10";
		case "removed":
			return "bg-destructive/10";
		default:
			return "";
	}
};

const lineNumberTone = (variant: DiffLine["variant"]) => {
	switch (variant) {
		case "added":
			return "text-emerald-600";
		case "removed":
			return "text-destructive";
		default:
			return "text-muted-foreground";
	}
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

type DiffPanelProps = {
	title: string;
	lines: DiffLine[];
	emptyLabel?: string;
	code: string;
	language: Language;
	containerRef: RefObject<HTMLDivElement | null>;
	onScroll: (event: UIEvent<HTMLDivElement>) => void;
	themeMode: "light" | "dark";
};

const DiffPanel = ({
	title,
	lines,
	emptyLabel,
	code,
	language,
	containerRef,
	onScroll,
	themeMode,
}: DiffPanelProps) => {
	const theme = getGruvboxTheme(themeMode);
	const normalizedCode = useMemo(() => normalizeCode(code), [code]);

	return (
		<div className="rounded border border-border bg-muted/30">
			<div className="border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
				{title}
			</div>
			{lines.length > 0 ? (
				<Highlight code={normalizedCode} language={language} theme={theme}>
					{({ tokens, getTokenProps, style }) => {
						const renderTokens = trimTrailingEmptyTokens(
							tokens,
							normalizedCode,
						);
						return (
							<div
								className="max-h-56 overflow-auto"
								ref={containerRef}
								onScroll={onScroll}
								style={{ ...style, backgroundColor: "transparent" }}
							>
								{lines.map((line) => {
									const tokenLine = renderTokens[line.lineNumber - 1];
									return (
										<div
											key={`${line.lineNumber}-${line.text}`}
											className={cn(
												"grid grid-cols-[minmax(2.5rem,auto)_1fr] gap-2 px-2 py-0.5 font-mono text-[11px] leading-5",
												lineTone(line.variant),
											)}
										>
											<span
												className={cn(
													"text-right",
													lineNumberTone(line.variant),
												)}
											>
												{line.lineNumber}
											</span>
											<span className="whitespace-pre text-foreground">
												{tokenLine
													? tokenLine.map((token, tokenIndex) => (
															<span
																key={`token-${line.lineNumber}-${tokenIndex}`}
																{...getTokenProps({ token, key: tokenIndex })}
															/>
														))
													: line.text.length > 0
														? line.text
														: " "}
											</span>
										</div>
									);
								})}
							</div>
						);
					}}
				</Highlight>
			) : (
				<div className="px-2 py-2 text-[11px] text-muted-foreground">
					{emptyLabel ?? ""}
				</div>
			)}
		</div>
	);
};

export const DiffView = ({
	path,
	label,
	oldText,
	newText,
	getLabel,
	onOpenFilePreview,
}: DiffViewProps) => {
	const oldSource = oldText ?? "";
	const newSource = newText ?? "";
	const isNewFile = oldText === null || oldText === undefined;
	const oldLinesSource = useMemo(
		() => (isNewFile ? [] : splitLines(oldSource)),
		[isNewFile, oldSource],
	);
	const newLinesSource = useMemo(() => splitLines(newSource), [newSource]);
	const diffOps = useMemo(
		() => buildDiffOps(oldLinesSource, newLinesSource),
		[oldLinesSource, newLinesSource],
	);
	const { oldLines, newLines } = useMemo(
		() => buildDiffLines(diffOps),
		[diffOps],
	);
	const language = useMemo(
		() => resolveLanguageFromPath(path) as Language,
		[path],
	);
	const themeMode = useResolvedTheme();
	const oldContainerRef = useRef<HTMLDivElement | null>(null);
	const newContainerRef = useRef<HTMLDivElement | null>(null);
	const isSyncingRef = useRef(false);

	const syncScroll = (
		source: HTMLDivElement,
		target: HTMLDivElement | null,
	) => {
		if (!target) {
			return;
		}
		if (isSyncingRef.current) {
			return;
		}
		isSyncingRef.current = true;
		target.scrollTop = source.scrollTop;
		target.scrollLeft = source.scrollLeft;
		requestAnimationFrame(() => {
			isSyncingRef.current = false;
		});
	};

	return (
		<div className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground">
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span>{getLabel("toolCall.diff")}</span>
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
			<div className="mt-2 grid gap-3">
				<DiffPanel
					title={getLabel("toolCall.original")}
					lines={oldLines}
					emptyLabel={isNewFile ? getLabel("toolCall.newFile") : undefined}
					code={oldSource}
					language={language}
					containerRef={oldContainerRef}
					onScroll={(event) =>
						syncScroll(event.currentTarget, newContainerRef.current)
					}
					themeMode={themeMode}
				/>
				<DiffPanel
					title={getLabel("toolCall.updated")}
					lines={newLines}
					code={newSource}
					language={language}
					containerRef={newContainerRef}
					onScroll={(event) =>
						syncScroll(event.currentTarget, oldContainerRef.current)
					}
					themeMode={themeMode}
				/>
			</div>
		</div>
	);
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
		() => resolveLanguageFromPath(path) as Language,
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
													"grid grid-cols-[minmax(2.5rem,auto)_minmax(2.5rem,auto)_1ch_1fr] gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
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
												"grid grid-cols-[minmax(2.5rem,auto)_minmax(2.5rem,auto)_1ch_1fr] gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
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
											<span className="whitespace-pre text-foreground">
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
