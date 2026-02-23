import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { E2EEMissingBanner } from "@/components/app/E2EEMissingBanner";
import { MessageItem } from "@/components/chat/MessageItem";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { Button } from "@/components/ui/button";
import type { PermissionResultNotification } from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";
import { useUiStore } from "@/lib/ui-store";

const SCROLL_THRESHOLD = 64;

export type ChatMessageListHandle = {
	scrollToIndex: (index: number) => void;
};

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
export const ChatMessageList = forwardRef<
	ChatMessageListHandle,
	ChatMessageListProps
>(function ChatMessageList(
	{
		activeSession,
		loadingMessage,
		hasMachineSelected,
		onCreateSession,
		onPermissionDecision,
	},
	ref,
) {
	const { setFileExplorerOpen, setFilePreviewPath } = useUiStore();
	const { t } = useTranslation();
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const isPinnedRef = useRef(true);
	const messages = activeSession?.messages ?? [];
	const showIndicator = !!activeSession?.sending;
	const isThinking = showIndicator && !activeSession?.streamingMessageId;
	const totalItems = messages.length + (showIndicator ? 1 : 0);

	const virtualizer = useVirtualizer({
		count: totalItems,
		getScrollElement: () => scrollContainerRef.current,
		estimateSize: () => 112,
		overscan: 8,
		getItemKey: (index) =>
			showIndicator && index === messages.length
				? "__thinking-indicator__"
				: (messages[index]?.id ?? `message-${index}`),
	});
	const virtualItems = virtualizer.getVirtualItems();

	useImperativeHandle(ref, () => ({
		scrollToIndex: (index: number) => {
			isPinnedRef.current = false;
			virtualizer.scrollToIndex(index, { align: "center" });
		},
	}));

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

	// Effect A — scroll listener + session switch reset
	// biome-ignore lint/correctness/useExhaustiveDependencies: sessionId triggers reset on session switch
	useEffect(() => {
		isPinnedRef.current = true;
		const el = scrollContainerRef.current;
		if (!el) return;
		const onScroll = () => {
			isPinnedRef.current =
				el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD;
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [activeSession?.sessionId]);

	// Effect B — scroll to bottom on new items (non-streaming)
	useEffect(() => {
		if (totalItems === 0 || !isPinnedRef.current || showIndicator) return;
		virtualizer.scrollToIndex(totalItems - 1, { align: "end" });
	}, [totalItems, showIndicator, virtualizer]);

	// Effect C — RAF loop to follow streaming content
	useEffect(() => {
		if (!showIndicator) return;
		const el = scrollContainerRef.current;
		if (!el) return;
		let rafId: number;
		const tick = () => {
			if (isPinnedRef.current) {
				el.scrollTop = el.scrollHeight - el.clientHeight;
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	}, [showIndicator]);

	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="mx-auto flex w-full max-w-5xl flex-1 min-h-0 flex-col gap-4 px-4 py-6">
				{activeSession?.e2eeStatus === "missing_key" ? (
					<E2EEMissingBanner />
				) : null}
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
							className="flex flex-1 items-center justify-center opacity-30"
							aria-live="polite"
						>
							<img
								src="/logo.svg"
								alt={t("common.appName")}
								className="h-20 w-20"
								draggable={false}
							/>
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
								if (showIndicator && item.index === messages.length) {
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
											<ThinkingIndicator isThinking={isThinking} />
										</div>
									);
								}
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
					</div>
				</div>
			</div>
		</main>
	);
});
