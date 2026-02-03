import type { ChatSession } from "@mobvibe/core";
import { useTranslation } from "react-i18next";
import { MessageItem } from "@/components/chat/MessageItem";
import type { PermissionResultNotification } from "@/lib/acp";
import { useUiStore } from "@/lib/ui-store";

export type ChatMessageListProps = {
	activeSession?: ChatSession;
	loadingMessage?: string;
	onPermissionDecision: (payload: {
		requestId: string;
		outcome: PermissionResultNotification["outcome"];
	}) => void;
};

export function ChatMessageList({
	activeSession,
	loadingMessage,
	onPermissionDecision,
}: ChatMessageListProps) {
	const { setFileExplorerOpen, setFilePreviewPath } = useUiStore();
	const { t } = useTranslation();
	const handleOpenFilePreview = (path: string) => {
		if (!activeSession?.cwd) {
			return;
		}
		setFilePreviewPath(path);
		setFileExplorerOpen(true);
	};

	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="mx-auto flex w-full max-w-5xl flex-1 min-h-0 flex-col gap-4 px-4 py-6">
				<div className="flex min-h-0 flex-1 flex-col gap-4">
					{!activeSession ? (
						<div className="text-muted-foreground mt-8 text-center text-sm">
							{t("chat.selectSession")}
						</div>
					) : null}
					{activeSession && activeSession.isLoading ? (
						<div className="text-muted-foreground mt-8 text-center text-sm whitespace-pre font-mono">
							{loadingMessage ?? t("common.loading")}
						</div>
					) : null}
					{activeSession &&
					!activeSession.isLoading &&
					activeSession.messages.length === 0 ? (
						<div className="text-muted-foreground mt-8 text-center text-sm whitespace-pre font-mono">
							{t("chat.startConversation")}
						</div>
					) : null}
					<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4">
						{activeSession?.messages.map((message) => (
							<MessageItem
								key={message.id}
								message={message}
								onPermissionDecision={onPermissionDecision}
								onOpenFilePreview={handleOpenFilePreview}
							/>
						))}
					</div>
				</div>
			</div>
		</main>
	);
}
