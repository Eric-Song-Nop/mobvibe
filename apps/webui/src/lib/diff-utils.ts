/**
 * Shared diff utilities extracted from DiffView.tsx.
 * Provides line-level diff computation and unified-diff parsing.
 */

export type DiffOp = {
	type: "equal" | "insert" | "delete";
	text: string;
};

export type UnifiedDiffLine = {
	type: "context" | "added" | "removed" | "hunk";
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
};

export const splitLines = (value: string): string[] => value.split(/\r?\n/);

export const buildDiffOps = (
	oldLines: string[],
	newLines: string[],
): DiffOp[] => {
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

export const backtrackDiff = (
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

/**
 * Parse unified diff format into structured lines.
 */
export const parseUnifiedDiff = (diff: string): UnifiedDiffLine[] => {
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

export const unifiedLineTone = (type: UnifiedDiffLine["type"]): string => {
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

export const unifiedIndicatorTone = (type: UnifiedDiffLine["type"]): string => {
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

export const getIndicatorChar = (type: UnifiedDiffLine["type"]): string => {
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
