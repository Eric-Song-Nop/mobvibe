import {
	FolderOpenIcon,
	Refresh01Icon,
	Refresh03Icon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useState } from "react";
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
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PlanEntry } from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";

export type AppHeaderProps = {
	backendLabel?: string;
	workspaceLabel?: string;
	workspacePath?: string;
	executionMode?: "local" | "worktree";
	branchLabel?: string;
	subdirectoryLabel?: string;
	contextLeftPercent?: number;
	statusMessage?: string;
	warningMessage?: string;
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

type SessionDetailItem = {
	key: string;
	label: string;
	value: string;
};

function SessionDetailsContent({ items }: { items: SessionDetailItem[] }) {
	return (
		<dl className="space-y-3">
			{items.map((item) => (
				<div key={item.key} className="space-y-1">
					<dt className="text-muted-foreground text-[11px] font-medium">
						{item.label}
					</dt>
					<dd className="text-sm break-words">{item.value}</dd>
				</div>
			))}
		</dl>
	);
}

export const AppHeader = memo(function AppHeader({
	backendLabel,
	workspaceLabel,
	workspacePath,
	executionMode,
	branchLabel,
	subdirectoryLabel,
	contextLeftPercent,
	statusMessage,
	warningMessage,
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
	const isMobile = useIsMobile();
	const [detailsOpen, setDetailsOpen] = useState(false);
	const summaryLabel = workspaceLabel ?? backendLabel;
	const hasContextLeftPercent =
		typeof contextLeftPercent === "number" &&
		Number.isFinite(contextLeftPercent);
	const detailItems: SessionDetailItem[] = [
		backendLabel
			? {
					key: "backend",
					label: t("session.backendLabel"),
					value: backendLabel,
				}
			: null,
		workspacePath
			? {
					key: "workspacePath",
					label: t("session.context.workspacePathLabel"),
					value: workspacePath,
				}
			: null,
		executionMode
			? {
					key: "executionMode",
					label: t("session.context.executionModeLabel"),
					value: t(`session.context.${executionMode}`),
				}
			: null,
		branchLabel
			? {
					key: "branch",
					label: t("session.context.branchLabel"),
					value: branchLabel,
				}
			: null,
		subdirectoryLabel
			? {
					key: "subdirectory",
					label: t("session.context.subdirectoryLabel"),
					value: subdirectoryLabel,
				}
			: null,
		hasContextLeftPercent
			? {
					key: "contextLeft",
					label: t("session.context.contextLeftLabel"),
					value: `${contextLeftPercent}%`,
				}
			: null,
	].filter((item): item is SessionDetailItem => item !== null);
	const showDetailsTrigger = Boolean(
		(backendLabel && backendLabel !== summaryLabel) ||
			workspacePath ||
			executionMode ||
			branchLabel ||
			subdirectoryLabel ||
			hasContextLeftPercent,
	);
	const detailsTitle = t("session.context.details");
	const detailsTrigger = showDetailsTrigger ? (
		<Button
			variant="ghost"
			size="xs"
			className="shrink-0"
			aria-label={detailsTitle}
			title={detailsTitle}
		>
			{detailsTitle}
		</Button>
	) : null;

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
				<div
					data-testid="session-header-meta"
					className="flex min-w-0 items-center gap-1.5 overflow-hidden sm:gap-2"
				>
					{summaryLabel ? (
						<Badge
							data-testid="session-header-summary"
							variant="secondary"
							className="min-w-0 max-w-full truncate"
							title={workspacePath}
						>
							{summaryLabel}
						</Badge>
					) : null}
					{plan && plan.length > 0 ? <PlanIndicator plan={plan} /> : null}
					<div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
						{showDetailsTrigger ? (
							isMobile ? (
								<>
									<Button
										variant="ghost"
										size="xs"
										className="shrink-0"
										aria-label={detailsTitle}
										title={detailsTitle}
										onClick={() => setDetailsOpen(true)}
									>
										{detailsTitle}
									</Button>
									<Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
										<SheetContent side="bottom" className="max-h-[50vh]">
											<SheetHeader>
												<SheetTitle>{detailsTitle}</SheetTitle>
											</SheetHeader>
											<div className="px-4 pb-4">
												<SessionDetailsContent items={detailItems} />
											</div>
										</SheetContent>
									</Sheet>
								</>
							) : (
								<Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
									<PopoverTrigger asChild>{detailsTrigger}</PopoverTrigger>
									<PopoverContent align="end" className="w-80">
										<div className="space-y-3">
											<h2 className="text-sm font-medium">{detailsTitle}</h2>
											<SessionDetailsContent items={detailItems} />
										</div>
									</PopoverContent>
								</Popover>
							)
						) : null}
					</div>
				</div>
			</div>

			{loadingMessage ? (
				<div
					className="text-muted-foreground mx-auto mt-2 w-full max-w-5xl text-xs"
					aria-live="polite"
				>
					{loadingMessage}
				</div>
			) : null}
			{warningMessage ? (
				<div
					className="text-warning mx-auto mt-2 w-full max-w-5xl text-xs"
					aria-live="polite"
				>
					{warningMessage}
				</div>
			) : null}
			{statusMessage ? (
				<div
					className="text-destructive mx-auto mt-2 w-full max-w-5xl text-xs"
					aria-live="polite"
				>
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
