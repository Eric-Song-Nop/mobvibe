import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DemoMessageItem } from "@/components/DemoMessageItem";
import type { DisplayMessage } from "@/hooks/use-streaming-demo";

interface DemoMessageListProps {
	messages: DisplayMessage[];
}

export function DemoMessageList({ messages }: DemoMessageListProps) {
	const { t } = useTranslation();
	const bottomRef = useRef<HTMLDivElement>(null);

	const lastMessage = messages[messages.length - 1];
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom whenever messages change
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [lastMessage]);

	if (messages.length === 0) {
		return (
			<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4">
					<p className="text-muted-foreground text-xs">
						{t("messageList.emptyState")}
					</p>
				</div>
			</main>
		);
	}

	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
					{messages.map((msg, index) => (
						<DemoMessageItem key={`${msg.role}-${index}`} message={msg} />
					))}
					<div ref={bottomRef} />
				</div>
			</div>
		</main>
	);
}
