import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	getStatusDotColor,
	ThoughtItemContent,
	ToolCallItemContent,
} from "@/components/chat/MessageItem";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ToolCallStatus } from "@/lib/acp";
import type { ChatMessage } from "@/lib/chat-store";
import type { ToolCallGroupDisplayItem } from "@/lib/group-tool-calls";
import { cn } from "@/lib/utils";

type ToolCallGroupProps = {
	group: ToolCallGroupDisplayItem;
	onOpenFilePreview?: (path: string) => void;
};

type StatusCounts = {
	completed: number;
	failed: number;
	pending: number;
};

function countStatuses(group: ToolCallGroupDisplayItem): StatusCounts {
	const counts: StatusCounts = { completed: 0, failed: 0, pending: 0 };
	for (const item of group.items) {
		if (item.kind !== "tool_call") continue;
		const status = (item as Extract<ChatMessage, { kind: "tool_call" }>).status;
		if (status === "completed") counts.completed++;
		else if (status === "failed") counts.failed++;
		else counts.pending++;
	}
	return counts;
}

function resolveOverallStatus(
	counts: StatusCounts,
): ToolCallStatus | undefined {
	if (counts.failed > 0) return "failed";
	if (counts.pending > 0) return undefined;
	return "completed";
}

export function ToolCallGroup({
	group,
	onOpenFilePreview,
}: ToolCallGroupProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	const counts = countStatuses(group);
	const overallStatus = resolveOverallStatus(counts);

	return (
		<Card size="sm" className="max-w-full border-border bg-background">
			<Collapsible open={open} onOpenChange={setOpen}>
				<CardHeader className="p-0">
					<CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors rounded-t-[inherit]">
						<HugeiconsIcon
							icon={open ? ArrowDown01Icon : ArrowRight01Icon}
							strokeWidth={2}
							className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span
							className={cn(
								"size-2 shrink-0 rounded-full",
								getStatusDotColor(overallStatus),
							)}
						/>
						<span className="text-sm text-foreground">
							{t("toolCall.toolCallGroup", {
								count: group.toolCallCount,
							})}
						</span>
						<div className="ml-auto flex items-center gap-1.5">
							{counts.completed > 0 ? (
								<Badge variant="secondary" className="text-[10px]">
									{t("toolCall.toolCallGroupCompleted", {
										count: counts.completed,
									})}
								</Badge>
							) : null}
							{counts.failed > 0 ? (
								<Badge variant="destructive" className="text-[10px]">
									{t("toolCall.toolCallGroupFailed", {
										count: counts.failed,
									})}
								</Badge>
							) : null}
							{counts.pending > 0 ? (
								<Badge variant="secondary" className="text-[10px]">
									{t("toolCall.toolCallGroupPending", {
										count: counts.pending,
									})}
								</Badge>
							) : null}
						</div>
					</CollapsibleTrigger>
				</CardHeader>
				<CollapsibleContent>
					<CardContent className="flex flex-col gap-3 pt-0">
						{group.items.map((item) => {
							if (item.kind === "tool_call") {
								return (
									<ToolCallItemContent
										key={item.id}
										message={
											item as Extract<ChatMessage, { kind: "tool_call" }>
										}
										onOpenFilePreview={onOpenFilePreview}
									/>
								);
							}
							return (
								<ThoughtItemContent
									key={item.id}
									message={item as Extract<ChatMessage, { kind: "thought" }>}
								/>
							);
						})}
					</CardContent>
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
}
