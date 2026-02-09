import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ChatSession } from "@mobvibe/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MessageItem } from "@/components/chat/MessageItem";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { Button } from "@/components/ui/button";
import type { PermissionResultNotification } from "@/lib/acp";
import { useUiStore } from "@/lib/ui-store";

export type ChatMessageListProps = {
	activeSession?: ChatSession;
	loadingMessage?: string;
	hasMachineSelected?: boolean;
	onCreateSession?: () => void;
	onPermissionDecision: (payload: {
		requestId: string;
		outcome: PermissionResultNotification["outcome"];
	}) => void;
};

const SCROLL_BOTTOM_THRESHOLD = 64;

export function ChatMessageList({
	activeSession,
	loadingMessage,
	hasMachineSelected,
	onCreateSession,
	onPermissionDecision,
}: ChatMessageListProps) {
	const { setFileExplorerOpen, setFilePreviewPath } = useUiStore();
	const { t } = useTranslation();
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const indicatorRef = useRef<HTMLDivElement>(null);
	const isPinnedToBottomRef = useRef(true);
	const activeSessionId = activeSession?.sessionId;
	const messages = activeSession?.messages ?? [];
	const showIndicator = !!activeSession?.sending;
	const isThinking = showIndicator && !activeSession?.streamingMessageId;

	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => scrollContainerRef.current,
		estimateSize: () => 112,
		overscan: 8,
		getItemKey: (index) => messages[index]?.id ?? index,
	});
	const virtualItems = virtualizer.getVirtualItems();

	const handleOpenFilePreview = useCallback(
		(path: string) => {
			if (!activeSession?.cwd) {
				return;
			}
			setFilePreviewPath(path);
			setFileExplorerOpen(true);
		},
		[activeSession?.cwd, setFilePreviewPath, setFileExplorerOpen],
	);

	useEffect(() => {
		if (activeSessionId) {
			isPinnedToBottomRef.current = true;
		}
		const scrollElement = scrollContainerRef.current;
		if (!scrollElement) {
			return;
		}
		const updatePinnedState = () => {
			const distanceToBottom =
				scrollElement.scrollHeight -
				scrollElement.scrollTop -
				scrollElement.clientHeight;
			isPinnedToBottomRef.current = distanceToBottom <= SCROLL_BOTTOM_THRESHOLD;
		};
		updatePinnedState();
		scrollElement.addEventListener("scroll", updatePinnedState, {
			passive: true,
		});
		return () => {
			scrollElement.removeEventListener("scroll", updatePinnedState);
		};
	}, [activeSessionId]);

	useLayoutEffect(() => {
		if (!isPinnedToBottomRef.current) {
			return;
		}
		if (showIndicator && indicatorRef.current) {
			indicatorRef.current.scrollIntoView({ block: "end" });
		} else if (messages.length > 0) {
			virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
		}
	}, [messages, virtualizer, showIndicator]);

	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="mx-auto flex w-full max-w-5xl flex-1 min-h-0 flex-col gap-4 px-4 py-6">
				<div className="flex min-h-0 flex-1 flex-col gap-4">
					{!activeSession ? (
						<div
							className="flex flex-1 flex-col items-center justify-center gap-3"
							aria-live="polite"
						>
							<p className="text-muted-foreground text-sm">
								{hasMachineSelected
									? t("chat.welcomeCreateSession")
									: t("chat.welcomeSelectMachine")}
							</p>
							{hasMachineSelected && onCreateSession ? (
								<Button variant="outline" onClick={onCreateSession}>
									<HugeiconsIcon
										icon={Add01Icon}
										className="mr-1 h-4 w-4"
										aria-hidden="true"
									/>
									{t("chat.createSession")}
								</Button>
							) : null}
						</div>
					) : null}
					{activeSession?.isLoading ? (
						<div
							className="text-muted-foreground mt-8 text-center text-sm whitespace-pre font-mono"
							aria-live="polite"
						>
							{loadingMessage ?? t("common.loading")}
						</div>
					) : null}
					{activeSession &&
					!activeSession.isLoading &&
					activeSession.messages.length === 0 ? (
						<div
							className="text-muted-foreground mt-8 text-center text-sm whitespace-pre font-mono"
							aria-live="polite"
						>
							{t("chat.startConversation")}
						</div>
					) : null}
					<div
						ref={scrollContainerRef}
						className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4"
					>
						<div
							className="relative w-full"
							style={{ height: `${virtualizer.getTotalSize()}px` }}
						>
							{virtualItems.map((item) => {
								const message = messages[item.index];
								if (!message) {
									return null;
								}
								return (
									<div
										key={item.key}
										data-index={item.index}
										ref={virtualizer.measureElement}
										className="absolute left-0 top-0 w-full pb-3"
										style={{
											transform: `translateY(${item.start}px)`,
										}}
									>
										<MessageItem
											message={message}
											onPermissionDecision={onPermissionDecision}
											onOpenFilePreview={handleOpenFilePreview}
										/>
									</div>
								);
							})}
						</div>
						{showIndicator ? (
							<div ref={indicatorRef}>
								<ThinkingIndicator isThinking={isThinking} />
							</div>
						) : null}
					</div>
				</div>
			</div>
		</main>
	);
}
