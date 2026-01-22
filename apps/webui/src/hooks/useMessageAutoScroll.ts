import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
	createAutoScrollState,
	shouldAutoScroll,
	updateAutoScrollState,
} from "@/lib/auto-scroll";
import type { ChatMessage } from "@/lib/chat-store";
import { AUTO_SCROLL_THRESHOLD } from "@/lib/ui-config";

export type MessageAutoScroll = {
	messageListRef: RefObject<HTMLDivElement | null>;
	endOfMessagesRef: RefObject<HTMLDivElement | null>;
	handleMessagesScroll: () => void;
};

export function useMessageAutoScroll(
	activeSessionId: string | undefined,
	messages: ChatMessage[],
): MessageAutoScroll {
	const messageListRef = useRef<HTMLDivElement | null>(null);
	const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
	const autoScrollStateRef = useRef(createAutoScrollState());
	const lastSessionIdRef = useRef<string | null>(null);

	const handleMessagesScroll = useCallback(() => {
		const container = messageListRef.current;
		if (!container) {
			return;
		}
		autoScrollStateRef.current = updateAutoScrollState(
			autoScrollStateRef.current,
			{
				scrollTop: container.scrollTop,
				scrollHeight: container.scrollHeight,
				clientHeight: container.clientHeight,
				threshold: AUTO_SCROLL_THRESHOLD,
			},
		);
	}, []);

	useLayoutEffect(() => {
		const sessionChanged = lastSessionIdRef.current !== activeSessionId;
		const container = messageListRef.current;

		if (sessionChanged) {
			lastSessionIdRef.current = activeSessionId ?? null;
			if (container) {
				autoScrollStateRef.current = updateAutoScrollState(
					{
						...autoScrollStateRef.current,
						hasUserScrolled: false,
						lastScrollTop: container.scrollTop,
					},
					{
						scrollTop: container.scrollTop,
						scrollHeight: container.scrollHeight,
						clientHeight: container.clientHeight,
						threshold: AUTO_SCROLL_THRESHOLD,
					},
				);
			} else {
				autoScrollStateRef.current = {
					...autoScrollStateRef.current,
					hasUserScrolled: false,
				};
			}
		}

		const endNode = endOfMessagesRef.current;
		if (!activeSessionId || !endNode) {
			return;
		}
		if (
			!shouldAutoScroll(autoScrollStateRef.current, {
				sessionChanged,
				hasMessages: messages.length > 0,
			})
		) {
			return;
		}
		requestAnimationFrame(() => {
			const nextEndNode = endOfMessagesRef.current;
			if (!nextEndNode) {
				return;
			}
			nextEndNode.scrollIntoView({ block: "end" });
			requestAnimationFrame(() => {
				nextEndNode.scrollIntoView({ block: "end" });
			});
		});
	}, [activeSessionId, messages]);

	return {
		messageListRef,
		endOfMessagesRef,
		handleMessagesScroll,
	};
}
