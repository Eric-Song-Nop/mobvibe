import {
	resolveFileTypeLabel,
	resolveFileTypeLabelColor,
} from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

type FileTypeLabelProps = {
	path: string;
	className?: string;
};

export function FileTypeLabel({ path, className }: FileTypeLabelProps) {
	const label = resolveFileTypeLabel(path);
	const colorClass = resolveFileTypeLabelColor(path);

	return (
		<span
			className={cn(
				"inline-flex h-4 min-w-[1.25rem] shrink-0 items-center justify-center text-[8px] font-bold leading-none",
				label ? colorClass : "text-muted-foreground",
				className,
			)}
			title={label || undefined}
			aria-hidden="true"
		>
			{label || "--"}
		</span>
	);
}
