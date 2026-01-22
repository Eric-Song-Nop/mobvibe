import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { UserMenu } from "@/components/auth/UserMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChatSession } from "@/lib/chat-store";

export type AppHeaderProps = {
	statusVariant: "default" | "destructive" | "secondary" | "outline";
	statusLabel: string;
	backendLabel?: string;
	statusMessage?: string;
	streamError?: ChatSession["streamError"];
	onOpenMobileMenu: () => void;
	onOpenFileExplorer?: () => void;
	showFileExplorer?: boolean;
	fileExplorerDisabled?: boolean;
};

export function AppHeader({
	statusVariant,
	statusLabel,
	backendLabel,
	statusMessage,
	streamError,
	onOpenMobileMenu,
	onOpenFileExplorer,
	showFileExplorer = false,
	fileExplorerDisabled = false,
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
					<Badge variant={statusVariant} className="shrink-0">
						{statusLabel}
					</Badge>
					{backendLabel ? (
						<Badge variant="outline" className="shrink-0">
							{t("status.backend")}: {backendLabel}
						</Badge>
					) : null}
				</div>
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
