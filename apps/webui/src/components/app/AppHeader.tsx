import {
	FolderOpenIcon,
	GitBranchIcon,
	Refresh01Icon,
	Refresh03Icon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { UserMenu } from "@/components/auth/UserMenu";
import PlanIndicator from "@/components/plan/plan-indicator";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlanEntry } from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";

export type AppHeaderProps = {
	backendLabel?: string;
	workspaceLabel?: string;
	workspacePath?: string;
	executionMode?: "local" | "worktree";
	branchLabel?: string;
	subdirectoryLabel?: string;
	statusMessage?: string;
	streamError?: ChatSession["streamError"];
	loadingMessage?: string;
	plan?: PlanEntry[];
	onOpenMobileMenu: () => void;
	onOpenFileExplorer?: () => void;
	onOpenCommandPalette?: () => void;
	onSyncHistory?: () => void;
	onForceReload?: () => void;
	showFileExplorer?: boolean;
	showSyncHistory?: boolean;
	fileExplorerDisabled?: boolean;
	syncHistoryDisabled?: boolean;
	showForceReload?: boolean;
	forceReloadDisabled?: boolean;
};

export const AppHeader = memo(function AppHeader({
	backendLabel,
	workspaceLabel,
	workspacePath,
	executionMode,
	branchLabel,
	subdirectoryLabel,
	statusMessage,
	streamError,
	loadingMessage,
	plan,
	onOpenMobileMenu,
	onOpenFileExplorer,
	onOpenCommandPalette,
	onSyncHistory,
	onForceReload,
	showFileExplorer = false,
	showSyncHistory = false,
	fileExplorerDisabled = false,
	syncHistoryDisabled = false,
	showForceReload = false,
	forceReloadDisabled = false,
}: AppHeaderProps) {
	const { t } = useTranslation();
	const executionModeIcon =
		executionMode === "worktree" ? GitBranchIcon : FolderOpenIcon;

	return (
		<header className="bg-background/80 border-b px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] backdrop-blur shrink-0 sm:px-4 sm:pb-3 sm:pt-[calc(0.75rem+env(safe-area-inset-top))]">
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5 sm:gap-2">
				<div className="flex items-center justify-between gap-1.5 sm:gap-2">
					<div className="flex items-center gap-1.5 sm:gap-2">
						<Button
							variant="outline"
							size="icon-sm"
							className="md:hidden"
							onClick={onOpenMobileMenu}
							aria-label={t("common.toggleMenu", "Toggle menu")}
						>
							☰
						</Button>
						<Button
							variant="outline"
							size="icon-sm"
							onClick={() => onOpenCommandPalette?.()}
							aria-label={t("commandPalette.openCommandPalette")}
							title={t("commandPalette.openCommandPalette")}
						>
							<HugeiconsIcon
								icon={Search01Icon}
								strokeWidth={2}
								aria-hidden="true"
							/>
						</Button>
					</div>
					<div className="flex items-center gap-1.5 sm:gap-2">
						{showSyncHistory ? (
							<Button
								variant="outline"
								size="icon-sm"
								aria-label={t("session.syncHistory")}
								title={t("session.syncHistory")}
								disabled={syncHistoryDisabled}
								onClick={() => onSyncHistory?.()}
							>
								<HugeiconsIcon
									icon={Refresh03Icon}
									strokeWidth={2}
									aria-hidden="true"
								/>
							</Button>
						) : null}
						{showForceReload ? (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button
										variant="destructive"
										size="icon-sm"
										aria-label={t("session.forceReloadTitle")}
										title={t("session.forceReloadTitle")}
										disabled={forceReloadDisabled}
									>
										<HugeiconsIcon
											icon={Refresh01Icon}
											strokeWidth={2}
											aria-hidden="true"
										/>
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent size="sm">
									<AlertDialogHeader>
										<AlertDialogTitle>
											{t("session.forceReloadTitle")}
										</AlertDialogTitle>
										<AlertDialogDescription>
											{t("session.forceReloadDescription")}
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
										<AlertDialogAction
											variant="destructive"
											onClick={() => onForceReload?.()}
										>
											{t("session.forceReloadConfirm")}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						) : null}
						{showFileExplorer ? (
							<Button
								variant="outline"
								size="icon-sm"
								aria-label={t("fileExplorer.openFileExplorer")}
								disabled={fileExplorerDisabled}
								onClick={() => onOpenFileExplorer?.()}
							>
								<HugeiconsIcon
									icon={FolderOpenIcon}
									strokeWidth={2}
									aria-hidden="true"
								/>
							</Button>
						) : null}
						<UserMenu />
					</div>
				</div>
				<div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
					{backendLabel ? (
						<Badge variant="outline" className="shrink-0">
							{backendLabel}
						</Badge>
					) : null}
					{workspaceLabel ? (
						<Badge
							variant="secondary"
							className="max-w-full truncate"
							title={workspacePath}
						>
							{workspaceLabel}
						</Badge>
					) : null}
					{executionMode ? (
						<Badge
							variant="outline"
							className="px-1.5"
							title={t(`session.context.${executionMode}`)}
						>
							<HugeiconsIcon
								icon={executionModeIcon}
								strokeWidth={2}
								aria-hidden="true"
							/>
						</Badge>
					) : null}
					{branchLabel ? (
						<Badge
							variant="outline"
							className="max-w-full truncate"
							title={branchLabel}
						>
							{branchLabel}
						</Badge>
					) : null}
					{subdirectoryLabel ? (
						<Badge
							variant="outline"
							className="max-w-full truncate"
							title={subdirectoryLabel}
						>
							{t("session.context.subdir", { path: subdirectoryLabel })}
						</Badge>
					) : null}
					{plan && plan.length > 0 ? <PlanIndicator plan={plan} /> : null}
				</div>
			</div>

			{loadingMessage ? (
				<div className="text-muted-foreground mx-auto mt-2 w-full max-w-5xl text-xs">
					{loadingMessage}
				</div>
			) : null}
			{statusMessage ? (
				<div className="text-muted-foreground mx-auto mt-2 w-full max-w-5xl text-xs">
					{statusMessage}
				</div>
			) : null}
			{streamError ? (
				<div className="text-destructive mx-auto mt-1 w-full max-w-5xl text-xs">
					{streamError.message}
				</div>
			) : null}
		</header>
	);
});
