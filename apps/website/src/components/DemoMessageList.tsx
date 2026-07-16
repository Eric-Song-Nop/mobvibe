import { Empty, EmptyDescription, EmptyHeader } from "@mobvibe/ui/empty";
import { Skeleton } from "@mobvibe/ui/skeleton";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DisplayMessage } from "@/hooks/use-streaming-demo";

const DemoMessageItem = lazy(async () => {
	const module = await import("@/components/DemoMessageItem");
	return { default: module.DemoMessageItem };
});

interface DemoMessageListProps {
	messages: DisplayMessage[];
}

export function DemoMessageList({ messages }: DemoMessageListProps) {
	const { t } = useTranslation();
	const bottomRef = useRef<HTMLDivElement>(null);

	const lastMessage = messages[messages.length - 1];
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom whenever messages change
	useEffect(() => {
		const prefersReducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		bottomRef.current?.scrollIntoView({
			behavior: prefersReducedMotion ? "auto" : "smooth",
		});
	}, [lastMessage]);

	if (messages.length === 0) {
		return (
			<main
				id="main-content"
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				<div className="mx-auto flex w-full max-w-5xl flex-1 px-4">
					<Empty>
						<EmptyHeader>
							<EmptyDescription>{t("messageList.emptyState")}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				</div>
			</main>
		);
	}

	return (
		<main
			id="main-content"
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
		>
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
					<Suspense fallback={<MessageListSkeleton />}>
						{messages.map((msg, index) => (
							<DemoMessageItem key={`${msg.role}-${index}`} message={msg} />
						))}
					</Suspense>
					<div ref={bottomRef} />
				</div>
			</div>
		</main>
	);
}

function MessageListSkeleton() {
	return (
		<div className="flex flex-col gap-3" aria-hidden="true">
			<Skeleton className="ml-auto h-10 w-2/5" />
			<Skeleton className="h-16 w-4/5" />
		</div>
	);
}
