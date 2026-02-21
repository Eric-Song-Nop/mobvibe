import type { GitFileStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

export const GIT_STATUS_CONFIG: Record<
	GitFileStatus,
	{ label: string; className: string }
> = {
	M: { label: "Modified", className: "text-amber-500" },
	A: { label: "Added", className: "text-green-500" },
	D: { label: "Deleted", className: "text-red-500" },
	"?": { label: "Untracked", className: "text-blue-400" },
	R: { label: "Renamed", className: "text-purple-500" },
	C: { label: "Copied", className: "text-cyan-500" },
	U: { label: "Unmerged", className: "text-orange-500" },
	"!": { label: "Ignored", className: "text-gray-400" },
};

export function GitStatusIndicator({ status }: { status: GitFileStatus }) {
	const config = GIT_STATUS_CONFIG[status];
	return (
		<span
			className={cn(
				"ml-auto shrink-0 text-[0.65rem] font-medium",
				config.className,
			)}
			title={config.label}
		>
			{status}
		</span>
	);
}
