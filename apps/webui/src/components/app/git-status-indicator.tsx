import { useTranslation } from "react-i18next";
import type { GitFileStatus } from "@/lib/api";
import { type CodeAccent, getCodeAccentTextClass } from "@/lib/code-highlight";
import { cn } from "@/lib/utils";

export const GIT_STATUS_CONFIG: Record<
	GitFileStatus,
	{ labelKey: string; accent: CodeAccent }
> = {
	M: { labelKey: "gitStatus.modified", accent: "yellow" },
	A: { labelKey: "gitStatus.added", accent: "green" },
	D: { labelKey: "gitStatus.deleted", accent: "red" },
	"?": { labelKey: "gitStatus.untracked", accent: "blue" },
	R: { labelKey: "gitStatus.renamed", accent: "purple" },
	C: { labelKey: "gitStatus.copied", accent: "aqua" },
	U: { labelKey: "gitStatus.unmerged", accent: "orange" },
	"!": { labelKey: "gitStatus.ignored", accent: "muted" },
};

export function GitStatusIndicator({ status }: { status: GitFileStatus }) {
	const { t } = useTranslation();
	const config = GIT_STATUS_CONFIG[status];
	return (
		<span
			className={cn(
				"ml-auto shrink-0 text-[0.65rem] font-medium",
				getCodeAccentTextClass(config.accent),
			)}
			title={t(config.labelKey)}
		>
			{status}
		</span>
	);
}
