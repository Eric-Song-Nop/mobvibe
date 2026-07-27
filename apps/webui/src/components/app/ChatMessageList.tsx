import { Add01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BrandLogo } from "@mobvibe/ui/brand-logo";
import { Button } from "@mobvibe/ui/button";
import { Skeleton } from "@mobvibe/ui/skeleton";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	forwardRef,
	useCallback,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { E2EEMissingBanner } from "@/components/app/E2EEMissingBanner";
import { MessageItem } from "@/components/chat/MessageItem";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { ToolCallGroup } from "@/components/chat/tool-call-group";
import type { PermissionResultNotification } from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";
import {
	buildMessageIndexMap,
	type DisplayItem,
	groupMessages,
} from "@/lib/group-tool-calls";
import { useUiStore } from "@/lib/ui-store";

const SCROLL_THRESHOLD = 64;
const THINKING_INDICATOR_KEY = "__thinking-indicator__";

function getDisplayItemKey(item: DisplayItem): string {
	if (item.type === "single") {
		return item.message.id;
	}
	const firstMessage = item.items[0];
	if (!firstMessage) {
		throw new Error("Tool call groups must contain at least one message");
	}
	return firstMessage.id;
}

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
	const initialScrollSessionRef = useRef<string | null>(null);
	const messages = activeSession?.messages ?? [];
	const showIndicator = !!activeSession?.sending;
	const isThinking = showIndicator && !activeSession?.streamingMessageId;
	const isHistorySyncing = Boolean(activeSession?.historySyncing);

	const displayItems = useMemo(() => groupMessages(messages), [messages]);
	const totalItems = displayItems.length + (showIndicator ? 1 : 0);
	const sessionKey = activeSession?.sessionId ?? "no-session";
	const trailingMessageId = messages.at(-1)?.id ?? "empty";
	const getItemKey = useCallback(
		(index: number) => {
			if (showIndicator && index === displayItems.length) {
				return `${sessionKey}:${THINKING_INDICATOR_KEY}:${trailingMessageId}`;
			}
			const displayItem = displayItems[index];
			if (!displayItem) {
				throw new RangeError(`Missing display item at virtual index ${index}`);
			}
			return `${sessionKey}:${getDisplayItemKey(displayItem)}`;
		},
		[displayItems, sessionKey, showIndicator, trailingMessageId],
	);

	const virtualizer = useVirtualizer({
		count: totalItems,
		getScrollElement: () => scrollContainerRef.current,
		estimateSize: () => 112,
		overscan: 8,
		getItemKey,
		anchorTo: "end",
		followOnAppend: true,
		scrollEndThreshold: SCROLL_THRESHOLD,
		directDomUpdates: true,
	});
	const virtualItems = virtualizer.getVirtualItems();
	const isAtLatest = totalItems === 0 || virtualizer.isAtEnd(SCROLL_THRESHOLD);

	// Pre-computed O(1) lookup map for message → display index
	const msgIndexMap = useMemo(
		() => buildMessageIndexMap(displayItems),
		[displayItems],
	);

	useImperativeHandle(ref, () => ({
		scrollToIndex: (msgIndex: number) => {
			const displayIndex =
				msgIndexMap.get(msgIndex) ?? Math.max(0, displayItems.length - 1);
			virtualizer.scrollToIndex(displayIndex, { align: "center" });
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

	useLayoutEffect(() => {
		const sessionId = activeSession?.sessionId;
		if (!sessionId || totalItems === 0) {
			initialScrollSessionRef.current = null;
			return;
		}
		if (initialScrollSessionRef.current === sessionId) {
			return;
		}
		initialScrollSessionRef.current = sessionId;
		virtualizer.scrollToEnd();
	}, [activeSession?.sessionId, totalItems, virtualizer]);

	const handleJumpToLatest = useCallback(() => {
		virtualizer.scrollToEnd();
		scrollContainerRef.current?.focus({ preventScroll: true });
	}, [virtualizer]);

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
					{activeSession &&
					isHistorySyncing &&
					activeSession.messages.length === 0 ? (
						<div className="flex flex-1 flex-col gap-4 pt-4" aria-live="polite">
							<div className="text-muted-foreground text-sm font-mono whitespace-pre">
								{loadingMessage ?? t("session.syncingHistory")}
							</div>
							<div className="flex flex-col gap-3">
								<div className="ml-auto flex w-[72%] flex-col gap-2 rounded-none border border-primary/20 bg-primary/5 p-4">
									<Skeleton className="h-3 w-20" />
									<Skeleton className="h-4 w-full" />
									<Skeleton className="h-4 w-4/5" />
								</div>
								<div className="flex w-[82%] flex-col gap-2 pl-4">
									<Skeleton className="h-3 w-16" />
									<Skeleton className="h-4 w-full" />
									<Skeleton className="h-4 w-3/4" />
								</div>
							</div>
						</div>
					) : null}
					{activeSession &&
					!activeSession.isLoading &&
					!isHistorySyncing &&
					activeSession.messages.length === 0 ? (
						<div
							className="flex flex-1 items-center justify-center opacity-30"
							aria-live="polite"
						>
							<BrandLogo
								alt={t("common.appName")}
								className="h-20 w-20"
								draggable={false}
							/>
						</div>
					) : null}
					<div className="relative min-h-0 flex-1">
						<section
							ref={scrollContainerRef}
							aria-label={t("chat.messageHistory")}
							// biome-ignore lint/a11y/noNoninteractiveTabindex: The overflowed chat transcript must be focusable for keyboard scrolling and focus handoff.
							tabIndex={0}
							className="h-full overflow-y-auto overscroll-contain pb-4 [overflow-anchor:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						>
							<div ref={virtualizer.containerRef} className="relative w-full">
								{virtualItems.map((item) => {
									if (showIndicator && item.index === displayItems.length) {
										return (
											<div
												key={item.key}
												data-index={item.index}
												ref={virtualizer.measureElement}
												className="absolute left-0 top-0 w-full pb-3"
											>
												<ThinkingIndicator isThinking={isThinking} />
											</div>
										);
									}
									const displayItem = displayItems[item.index];
									if (!displayItem) {
										return null;
									}
									return (
										<div
											key={item.key}
											data-index={item.index}
											ref={virtualizer.measureElement}
											className="absolute left-0 top-0 w-full pb-3"
										>
											{displayItem.type === "tool_call_group" ? (
												<ToolCallGroup
													group={displayItem}
													onOpenFilePreview={handleOpenFilePreview}
												/>
											) : (
												<MessageItem
													message={displayItem.message}
													onPermissionDecision={onPermissionDecision}
													onOpenFilePreview={handleOpenFilePreview}
												/>
											)}
										</div>
									);
								})}
							</div>
						</section>
						<div
							className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center"
							aria-live="polite"
						>
							{isAtLatest ? null : (
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="pointer-events-auto bg-background/95 shadow-sm backdrop-blur-sm"
									onClick={handleJumpToLatest}
								>
									<HugeiconsIcon
										icon={ArrowDown01Icon}
										className="h-4 w-4"
										aria-hidden="true"
									/>
									{t("chat.jumpToLatest")}
								</Button>
							)}
						</div>
					</div>
				</div>
			</div>
		</main>
	);
});
