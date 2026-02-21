import type { Token } from "prism-react-renderer";
import { Highlight } from "prism-react-renderer";
import { useMemo } from "react";
import {
	getGruvboxTheme,
	normalizeCode,
	resolvePrismLanguage,
	useResolvedTheme,
} from "@/lib/code-highlight";
import { buildDiffOps, type DiffOp, splitLines } from "@/lib/diff-utils";
import { resolveLanguageFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

type SideBySideLine = {
	left: { lineNum?: number; content: string; type: DiffOp["type"] } | null;
	right: { lineNum?: number; content: string; type: DiffOp["type"] } | null;
};

function buildSideBySideLines(ops: DiffOp[]): SideBySideLine[] {
	const lines: SideBySideLine[] = [];
	let oldLineNum = 1;
	let newLineNum = 1;
	let i = 0;

	while (i < ops.length) {
		const op = ops[i];

		if (op.type === "equal") {
			lines.push({
				left: { lineNum: oldLineNum, content: op.text, type: "equal" },
				right: { lineNum: newLineNum, content: op.text, type: "equal" },
			});
			oldLineNum++;
			newLineNum++;
			i++;
		} else if (op.type === "delete") {
			// Collect consecutive deletes and inserts for paired rendering
			const deletes: DiffOp[] = [];
			while (i < ops.length && ops[i].type === "delete") {
				deletes.push(ops[i]);
				i++;
			}
			const inserts: DiffOp[] = [];
			while (i < ops.length && ops[i].type === "insert") {
				inserts.push(ops[i]);
				i++;
			}

			const maxLen = Math.max(deletes.length, inserts.length);
			for (let j = 0; j < maxLen; j++) {
				lines.push({
					left:
						j < deletes.length
							? {
									lineNum: oldLineNum + j,
									content: deletes[j].text,
									type: "delete",
								}
							: null,
					right:
						j < inserts.length
							? {
									lineNum: newLineNum + j,
									content: inserts[j].text,
									type: "insert",
								}
							: null,
				});
			}
			oldLineNum += deletes.length;
			newLineNum += inserts.length;
		} else {
			// Standalone insert
			lines.push({
				left: null,
				right: { lineNum: newLineNum, content: op.text, type: "insert" },
			});
			newLineNum++;
			i++;
		}
	}

	return lines;
}

const lineBg = (type: DiffOp["type"] | undefined) => {
	switch (type) {
		case "insert":
			return "bg-emerald-500/10";
		case "delete":
			return "bg-destructive/10";
		default:
			return "";
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

type SideBySideDiffViewProps = {
	oldText: string;
	newText: string;
	path: string;
};

export function SideBySideDiffView({
	oldText,
	newText,
	path,
}: SideBySideDiffViewProps) {
	const themeMode = useResolvedTheme();
	const theme = getGruvboxTheme(themeMode);
	const language = useMemo(
		() => resolvePrismLanguage(resolveLanguageFromPath(path)),
		[path],
	);

	const ops = useMemo(
		() => buildDiffOps(splitLines(oldText), splitLines(newText)),
		[oldText, newText],
	);

	const sideBySideLines = useMemo(() => buildSideBySideLines(ops), [ops]);

	// Build code strings for each side (for syntax highlighting)
	const leftCode = useMemo(
		() =>
			normalizeCode(
				sideBySideLines.map((l) => l.left?.content ?? "").join("\n"),
			),
		[sideBySideLines],
	);
	const rightCode = useMemo(
		() =>
			normalizeCode(
				sideBySideLines.map((l) => l.right?.content ?? "").join("\n"),
			),
		[sideBySideLines],
	);

	return (
		<div className="grid grid-cols-2 divide-x divide-border max-h-56 overflow-auto">
			{/* Left pane (old) */}
			<Highlight code={leftCode} language={language} theme={theme}>
				{({ tokens, getTokenProps, style }) => {
					const renderTokens = trimTrailingEmptyTokens(tokens, leftCode);
					return (
						<div style={{ ...style, backgroundColor: "transparent" }}>
							{sideBySideLines.map((line, idx) => {
								const tokenLine = renderTokens[idx];
								return (
									<div
										key={`left-${idx}`}
										className={cn(
											"grid grid-cols-[2.5rem_1fr] gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
											lineBg(line.left?.type),
										)}
									>
										<span className="text-right text-muted-foreground select-none">
											{line.left?.lineNum ?? ""}
										</span>
										<span className="whitespace-pre overflow-hidden">
											{line.left
												? tokenLine
													? tokenLine.map((token, tIdx) => (
															<span
																key={`lt-${idx}-${tIdx}`}
																{...getTokenProps({ token, key: tIdx })}
															/>
														))
													: line.left.content || " "
												: " "}
										</span>
									</div>
								);
							})}
						</div>
					);
				}}
			</Highlight>

			{/* Right pane (new) */}
			<Highlight code={rightCode} language={language} theme={theme}>
				{({ tokens, getTokenProps, style }) => {
					const renderTokens = trimTrailingEmptyTokens(tokens, rightCode);
					return (
						<div style={{ ...style, backgroundColor: "transparent" }}>
							{sideBySideLines.map((line, idx) => {
								const tokenLine = renderTokens[idx];
								return (
									<div
										key={`right-${idx}`}
										className={cn(
											"grid grid-cols-[2.5rem_1fr] gap-1 px-2 py-0.5 font-mono text-[11px] leading-5",
											lineBg(line.right?.type),
										)}
									>
										<span className="text-right text-muted-foreground select-none">
											{line.right?.lineNum ?? ""}
										</span>
										<span className="whitespace-pre overflow-hidden">
											{line.right
												? tokenLine
													? tokenLine.map((token, tIdx) => (
															<span
																key={`rt-${idx}-${tIdx}`}
																{...getTokenProps({ token, key: tIdx })}
															/>
														))
													: line.right.content || " "
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
	);
}
