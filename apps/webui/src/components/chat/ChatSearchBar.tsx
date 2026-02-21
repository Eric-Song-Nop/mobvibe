import {
	ArrowDown01Icon,
	ArrowUp01Icon,
	Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ChatSession } from "@/lib/chat-store";

type Message = ChatSession["messages"][number];

export type ChatSearchBarProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	messages: Message[];
	onScrollToMessage: (messageIndex: number) => void;
};

/**
 * Extract searchable text from a chat message.
 */
function getMessageText(message: Message): string {
	if (message.kind === "text" || message.kind === "thought") {
		return message.content ?? "";
	}
	if (message.kind === "tool_call") {
		return message.name ?? "";
	}
	return "";
}

export function ChatSearchBar({
	open,
	onOpenChange,
	messages,
	onScrollToMessage,
}: ChatSearchBarProps) {
	const { t } = useTranslation();
	const [query, setQuery] = useState("");
	const [currentMatch, setCurrentMatch] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Find all matching message indices
	const matches = useMemo(() => {
		if (!query.trim()) return [];
		const lowerQuery = query.toLowerCase();
		const results: number[] = [];
		for (let i = 0; i < messages.length; i++) {
			const text = getMessageText(messages[i]).toLowerCase();
			if (text.includes(lowerQuery)) {
				results.push(i);
			}
		}
		return results;
	}, [messages, query]);

	// Reset current match when matches change
	// biome-ignore lint/correctness/useExhaustiveDependencies: matches.length triggers reset on search results change
	useEffect(() => {
		setCurrentMatch(0);
	}, [matches.length]);

	// Auto-focus input on open
	useEffect(() => {
		if (open) {
			setQuery("");
			setCurrentMatch(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	// Scroll to current match
	useEffect(() => {
		if (matches.length > 0 && currentMatch < matches.length) {
			onScrollToMessage(matches[currentMatch]);
		}
	}, [currentMatch, matches, onScrollToMessage]);

	const goToNext = useCallback(() => {
		if (matches.length === 0) return;
		setCurrentMatch((prev) => (prev + 1) % matches.length);
	}, [matches.length]);

	const goToPrevious = useCallback(() => {
		if (matches.length === 0) return;
		setCurrentMatch((prev) => (prev === 0 ? matches.length - 1 : prev - 1));
	}, [matches.length]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onOpenChange(false);
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (e.shiftKey) {
					goToPrevious();
				} else {
					goToNext();
				}
			}
		},
		[onOpenChange, goToNext, goToPrevious],
	);

	if (!open) return null;

	return (
		<div className="bg-background border-b px-4 py-2 shrink-0">
			<div className="mx-auto flex w-full max-w-5xl items-center gap-2">
				<input
					ref={inputRef}
					type="text"
					className="bg-muted min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
					placeholder={t("chatSearch.placeholder")}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
				/>
				{query ? (
					<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
						{matches.length > 0
							? t("chatSearch.matchCount", {
									current: currentMatch + 1,
									total: matches.length,
								})
							: t("chatSearch.noResults")}
					</span>
				) : null}
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={goToPrevious}
					disabled={matches.length === 0}
					aria-label="Previous match"
				>
					<HugeiconsIcon
						icon={ArrowUp01Icon}
						strokeWidth={2}
						className="h-4 w-4"
						aria-hidden="true"
					/>
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={goToNext}
					disabled={matches.length === 0}
					aria-label="Next match"
				>
					<HugeiconsIcon
						icon={ArrowDown01Icon}
						strokeWidth={2}
						className="h-4 w-4"
						aria-hidden="true"
					/>
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => onOpenChange(false)}
					aria-label="Close search"
				>
					<HugeiconsIcon
						icon={Cancel01Icon}
						strokeWidth={2}
						className="h-4 w-4"
						aria-hidden="true"
					/>
				</Button>
			</div>
		</div>
	);
}
