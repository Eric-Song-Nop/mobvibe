import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { MessageItem } from "@/components/chat/MessageItem";
import type { PermissionResultNotification } from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";

export type ChatMessageListProps = {
	activeSession?: ChatSession;
	onPermissionDecision: (payload: {
		requestId: string;
		outcome: PermissionResultNotification["outcome"];
	}) => void;
	onOpenFilePreview?: (path: string) => void;
	messageListRef: RefObject<HTMLDivElement | null>;
	endOfMessagesRef: RefObject<HTMLDivElement | null>;
	onMessagesScroll: () => void;
};

export function ChatMessageList({
	activeSession,
	onPermissionDecision,
	onOpenFilePreview,
	messageListRef,
	endOfMessagesRef,
	onMessagesScroll,
}: ChatMessageListProps) {
	const { t } = useTranslation();

	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="mx-auto flex w-full max-w-5xl flex-1 min-h-0 flex-col gap-4 px-4 py-6">
				<div className="flex min-h-0 flex-1 flex-col gap-4">
					{!activeSession ? (
						<div className="text-muted-foreground mt-8 text-center text-sm">
							{t("chat.selectSession")}
						</div>
					) : null}
					{activeSession && activeSession.messages.length === 0 ? (
						<div className="text-muted-foreground mt-8 text-center text-sm">
							{t("chat.startConversation")}
						</div>
					) : null}
					<div
						className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4"
						ref={messageListRef}
						onScroll={onMessagesScroll}
					>
						{activeSession?.messages.map((message) => (
							<MessageItem
								key={message.id}
								message={message}
								onPermissionDecision={onPermissionDecision}
								onOpenFilePreview={onOpenFilePreview}
							/>
						))}
						<div ref={endOfMessagesRef} />
					</div>
				</div>
			</div>
		</main>
	);
}
