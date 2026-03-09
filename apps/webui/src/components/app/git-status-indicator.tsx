import type { GitFileStatus } from "@/lib/api";
import { type CodeAccent, getCodeAccentTextClass } from "@/lib/code-highlight";
import { cn } from "@/lib/utils";

export const GIT_STATUS_CONFIG: Record<
	GitFileStatus,
	{ label: string; accent: CodeAccent }
> = {
	M: { label: "Modified", accent: "yellow" },
	A: { label: "Added", accent: "green" },
	D: { label: "Deleted", accent: "red" },
	"?": { label: "Untracked", accent: "blue" },
	R: { label: "Renamed", accent: "purple" },
	C: { label: "Copied", accent: "aqua" },
	U: { label: "Unmerged", accent: "orange" },
	"!": { label: "Ignored", accent: "muted" },
};

export function GitStatusIndicator({ status }: { status: GitFileStatus }) {
	const config = GIT_STATUS_CONFIG[status];
	return (
		<span
			className={cn(
				"ml-auto shrink-0 text-[0.65rem] font-medium",
				getCodeAccentTextClass(config.accent),
			)}
			title={config.label}
		>
			{status}
		</span>
	);
}
