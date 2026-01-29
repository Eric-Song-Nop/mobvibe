import { useMemo } from "react";
import { cn } from "@/lib/utils";

type DiffViewProps = {
	path: string;
	label: string;
	oldText?: string | null;
	newText: string;
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

const renderLines = (lines: DiffLine[]) => (
	<div className="max-h-56 overflow-auto">
		{lines.map((line) => (
			<div
				key={`${line.lineNumber}-${line.text}`}
				className={cn(
					"grid grid-cols-[minmax(2.5rem,auto)_1fr] gap-2 px-2 py-0.5 font-mono text-[11px] leading-5",
					lineTone(line.variant),
				)}
			>
				<span className={cn("text-right", lineNumberTone(line.variant))}>
					{line.lineNumber}
				</span>
				<span className="whitespace-pre-wrap break-words text-foreground">
					{line.text.length > 0 ? line.text : " "}
				</span>
			</div>
		))}
	</div>
);

const DiffPanel = ({
	title,
	lines,
	emptyLabel,
}: {
	title: string;
	lines: DiffLine[];
	emptyLabel?: string;
}) => (
	<div className="rounded border border-border bg-muted/30">
		<div className="border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
			{title}
		</div>
		{lines.length > 0 ? (
			renderLines(lines)
		) : (
			<div className="px-2 py-2 text-[11px] text-muted-foreground">
				{emptyLabel ?? ""}
			</div>
		)}
	</div>
);

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
	const diffOps = useMemo(
		() => buildDiffOps(splitLines(oldSource), splitLines(newSource)),
		[oldSource, newSource],
	);
	const { oldLines, newLines } = useMemo(
		() => buildDiffLines(diffOps),
		[diffOps],
	);

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
				/>
				<DiffPanel title={getLabel("toolCall.updated")} lines={newLines} />
			</div>
		</div>
	);
};
