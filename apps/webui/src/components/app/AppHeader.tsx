import {
	FolderOpenIcon,
	Refresh01Icon,
	Refresh03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ChatSession } from "@mobvibe/core";
import { useTranslation } from "react-i18next";
import { UserMenu } from "@/components/auth/UserMenu";
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

export type AppHeaderProps = {
	backendLabel?: string;
	statusMessage?: string;
	streamError?: ChatSession["streamError"];
	loadingMessage?: string;
	onOpenMobileMenu: () => void;
	onOpenFileExplorer?: () => void;
	onSyncHistory?: () => void;
	onForceReload?: () => void;
	showFileExplorer?: boolean;
	showSyncHistory?: boolean;
	fileExplorerDisabled?: boolean;
	syncHistoryDisabled?: boolean;
	showForceReload?: boolean;
	forceReloadDisabled?: boolean;
};

export function AppHeader({
	backendLabel,
	statusMessage,
	streamError,
	loadingMessage,
	onOpenMobileMenu,
	onOpenFileExplorer,
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

	return (
		<header className="bg-background/80 border-b px-4 py-3 backdrop-blur shrink-0">
			<div className="mx-auto flex w-full max-w-5xl items-center gap-2">
				<Button
					variant="outline"
					size="icon"
					className="md:hidden"
					onClick={onOpenMobileMenu}
				>
					☰
				</Button>
				<div className="flex flex-1 flex-wrap items-center gap-2">
					{backendLabel ? (
						<Badge variant="outline" className="shrink-0">
							{backendLabel}
						</Badge>
					) : null}
				</div>
				{showSyncHistory ? (
					<Button
						variant="outline"
						size="sm"
						aria-label={t("session.syncHistory")}
						title={t("session.syncHistory")}
						disabled={syncHistoryDisabled}
						onClick={() => onSyncHistory?.()}
					>
						<HugeiconsIcon icon={Refresh03Icon} strokeWidth={2} />
					</Button>
				) : null}
				{showForceReload ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								variant="destructive"
								size="sm"
								aria-label={t("session.forceReloadTitle")}
								title={t("session.forceReloadTitle")}
								disabled={forceReloadDisabled}
							>
								<HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
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
						<HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
					</Button>
				) : null}
				<UserMenu />
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
}
