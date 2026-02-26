import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileTypeLabel } from "@/components/app/file-type-label";
import { GitStatusIndicator } from "@/components/app/git-status-indicator";
import type { GitFileStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

export type GitChangesViewProps = {
	staged: Array<{ path: string; status: GitFileStatus }>;
	unstaged: Array<{ path: string; status: GitFileStatus }>;
	untracked: Array<{ path: string }>;
	onFileSelect: (relativePath: string) => void;
	selectedFilePath?: string;
};

function FileGroup({
	title,
	files,
	defaultExpanded = true,
	onFileSelect,
	selectedFilePath,
}: {
	title: string;
	files: Array<{ path: string; status: GitFileStatus }>;
	defaultExpanded?: boolean;
	onFileSelect: (relativePath: string) => void;
	selectedFilePath?: string;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	const toggleExpand = useCallback(() => {
		setExpanded((prev) => !prev);
	}, []);

	if (files.length === 0) return null;

	return (
		<div className="flex flex-col">
			<button
				type="button"
				aria-expanded={expanded}
				className="text-muted-foreground hover:bg-muted flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium"
				onClick={toggleExpand}
			>
				<HugeiconsIcon
					icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
					strokeWidth={2}
					className="h-3.5 w-3.5 shrink-0"
					aria-hidden="true"
				/>
				<span>{title}</span>
				<span className="text-muted-foreground/60 ml-1">({files.length})</span>
			</button>
			{expanded ? (
				<div className="flex flex-col">
					{files.map((file) => {
						const isSelected = file.path === selectedFilePath;
						return (
							<button
								key={file.path}
								type="button"
								className={cn(
									"hover:bg-muted flex min-h-[2.75rem] w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
									isSelected && "bg-muted",
								)}
								onClick={() => onFileSelect(file.path)}
							>
								<FileTypeLabel path={file.path} />
								<span className="min-w-0 flex-1 truncate">{file.path}</span>
								<GitStatusIndicator status={file.status} />
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

export function GitChangesView({
	staged,
	unstaged,
	untracked,
	onFileSelect,
	selectedFilePath,
}: GitChangesViewProps) {
	const { t } = useTranslation();
	const totalCount = staged.length + unstaged.length + untracked.length;

	// Map untracked to include status for FileGroup compatibility
	const untrackedWithStatus = useMemo(
		() =>
			untracked.map((f) => ({ path: f.path, status: "?" as GitFileStatus })),
		[untracked],
	);

	if (totalCount === 0) {
		return (
			<div className="text-muted-foreground flex flex-1 items-center justify-center px-3 text-xs">
				{t("fileExplorer.noChanges")}
			</div>
		);
	}

	return (
		<div className="border-input bg-muted/30 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-none border">
			<FileGroup
				title={t("fileExplorer.stagedGroup")}
				files={staged}
				onFileSelect={onFileSelect}
				selectedFilePath={selectedFilePath}
			/>
			<FileGroup
				title={t("fileExplorer.unstagedGroup")}
				files={unstaged}
				onFileSelect={onFileSelect}
				selectedFilePath={selectedFilePath}
			/>
			<FileGroup
				title={t("fileExplorer.untrackedGroup")}
				files={untrackedWithStatus}
				onFileSelect={onFileSelect}
				selectedFilePath={selectedFilePath}
			/>
		</div>
	);
}
