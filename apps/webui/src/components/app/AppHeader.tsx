import { FolderOpenIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
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
	onOpenMobileMenu: () => void;
	onOpenFileExplorer?: () => void;
	onForceReload?: () => void;
	showFileExplorer?: boolean;
	fileExplorerDisabled?: boolean;
	showForceReload?: boolean;
	forceReloadDisabled?: boolean;
};

export function AppHeader({
	backendLabel,
	statusMessage,
	streamError,
	onOpenMobileMenu,
	onOpenFileExplorer,
	onForceReload,
	showFileExplorer = false,
	fileExplorerDisabled = false,
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
							{t("status.backend")}: {backendLabel}
						</Badge>
					) : null}
				</div>
				{showForceReload ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								disabled={forceReloadDisabled}
							>
								<HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
								<span className="sr-only">{t("session.forceReload")}</span>
								<span className="hidden sm:inline">
									{t("session.forceReload")}
								</span>
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
