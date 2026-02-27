import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyStreamdown } from "@/components/chat/LazyStreamdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PlanEntry, PlanEntryPriority, PlanEntryStatus } from "@/lib/acp";
import { cn } from "@/lib/utils";

// --- Helpers ---

type PlanStatusCounts = {
	completed: number;
	inProgress: number;
	pending: number;
	total: number;
};

function countPlanStatuses(entries: PlanEntry[]): PlanStatusCounts {
	let completed = 0;
	let inProgress = 0;
	let pending = 0;
	for (const entry of entries) {
		switch (entry.status) {
			case "completed":
				completed++;
				break;
			case "in_progress":
				inProgress++;
				break;
			case "pending":
				pending++;
				break;
		}
	}
	return { completed, inProgress, pending, total: entries.length };
}

function getPlanStatusDotClass(status: PlanEntryStatus): string {
	switch (status) {
		case "completed":
			return "bg-green-600";
		case "in_progress":
			return "bg-amber-500 animate-pulse";
		case "pending":
			return "border border-muted-foreground bg-transparent";
	}
}

function getPriorityBadgeVariant(
	priority: PlanEntryPriority,
): "destructive" | "secondary" | "outline" {
	switch (priority) {
		case "high":
			return "destructive";
		case "medium":
			return "secondary";
		case "low":
			return "outline";
	}
}

// --- Sub-components ---

function PlanProgressBar({
	counts,
	size,
}: {
	counts: PlanStatusCounts;
	size: "mini" | "full";
}) {
	const { total, completed, inProgress } = counts;
	if (total === 0) return null;

	const completedPct = (completed / total) * 100;
	const inProgressPct = (inProgress / total) * 100;

	return (
		<div
			className={cn(
				"bg-muted overflow-hidden rounded-full",
				size === "mini" ? "h-1 w-20" : "h-1.5 w-full",
			)}
		>
			<div className="flex h-full">
				<div
					className="bg-green-600 transition-[width] duration-500"
					style={{ width: `${completedPct}%` }}
				/>
				<div
					className="bg-amber-500 transition-[width] duration-500"
					style={{ width: `${inProgressPct}%` }}
				/>
			</div>
		</div>
	);
}

function PlanEntryItem({ entry }: { entry: PlanEntry }) {
	const { t } = useTranslation();
	const isLong =
		entry.content.length > 200 || (entry.content.match(/\n/g)?.length ?? 0) > 3;
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="flex gap-2 py-1.5">
			<div className="mt-1 shrink-0">
				<div
					className={cn(
						"size-2 rounded-full",
						getPlanStatusDotClass(entry.status),
					)}
				/>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-start gap-1.5">
					<div
						className={cn(
							"min-w-0 flex-1 text-xs",
							entry.status === "in_progress" && "font-medium",
							entry.status === "completed" &&
								"text-muted-foreground line-through",
							entry.status === "pending" && "text-muted-foreground",
						)}
					>
						{isLong && !expanded ? (
							<div className="relative max-h-[4.5rem] overflow-hidden">
								<span className="whitespace-pre-wrap">{entry.content}</span>
								<div className="from-popover pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t" />
							</div>
						) : isLong && expanded ? (
							<div className="max-h-60 overflow-y-auto">
								<LazyStreamdown>{entry.content}</LazyStreamdown>
							</div>
						) : (
							<span className="whitespace-pre-wrap">{entry.content}</span>
						)}
					</div>
					{entry.status !== "completed" && (
						<Badge
							variant={getPriorityBadgeVariant(entry.priority)}
							className="shrink-0 text-[10px] leading-none"
						>
							{t(`plan.priority.${entry.priority}`)}
						</Badge>
					)}
				</div>
				{isLong && (
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0 text-[10px]"
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? t("plan.showLess") : t("plan.showMore")}
					</Button>
				)}
			</div>
		</div>
	);
}

function PlanDetailContent({ entries }: { entries: PlanEntry[] }) {
	const { t } = useTranslation();
	const counts = countPlanStatuses(entries);

	const inProgressEntries = entries.filter((e) => e.status === "in_progress");
	const pendingEntries = entries.filter((e) => e.status === "pending");
	const completedEntries = entries.filter((e) => e.status === "completed");

	return (
		<div className="max-h-[60vh] space-y-3 overflow-y-auto">
			{/* Header */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">{t("plan.title")}</span>
					<span className="text-muted-foreground text-xs">
						{t("plan.completedCount", {
							completed: counts.completed,
							total: counts.total,
						})}
					</span>
				</div>
				<PlanProgressBar counts={counts} size="full" />
				<div className="text-muted-foreground flex flex-wrap gap-2 text-[10px]">
					{counts.completed > 0 && (
						<span>
							{t("plan.summaryCompleted", { count: counts.completed })}
						</span>
					)}
					{counts.inProgress > 0 && (
						<span>
							· {t("plan.summaryInProgress", { count: counts.inProgress })}
						</span>
					)}
					{counts.pending > 0 && (
						<span>· {t("plan.summaryPending", { count: counts.pending })}</span>
					)}
				</div>
			</div>

			{/* In Progress */}
			{inProgressEntries.length > 0 && (
				<div className="space-y-0.5">
					{inProgressEntries.map((entry, i) => (
						<PlanEntryItem key={`ip-${i}`} entry={entry} />
					))}
				</div>
			)}

			{/* Pending */}
			{pendingEntries.length > 0 && (
				<div className="space-y-0.5">
					{pendingEntries.map((entry, i) => (
						<PlanEntryItem key={`pd-${i}`} entry={entry} />
					))}
				</div>
			)}

			{/* Completed (collapsible) */}
			{completedEntries.length > 0 && (
				<Collapsible>
					<CollapsibleTrigger className="text-muted-foreground flex w-full items-center gap-1 text-[10px] hover:underline">
						<HugeiconsIcon
							icon={ArrowDown01Icon}
							strokeWidth={2}
							className="size-3 group-data-[state=open]:hidden"
						/>
						<HugeiconsIcon
							icon={ArrowUp01Icon}
							strokeWidth={2}
							className="size-3 group-data-[state=closed]:hidden"
						/>
						{t("plan.completedSection", { count: completedEntries.length })}
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="mt-1 space-y-0.5">
							{completedEntries.map((entry, i) => (
								<PlanEntryItem key={`cp-${i}`} entry={entry} />
							))}
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
}

// --- Main component ---

export default function PlanIndicator({ plan }: { plan: PlanEntry[] }) {
	const isMobile = useIsMobile();
	const [sheetOpen, setSheetOpen] = useState(false);
	const counts = countPlanStatuses(plan);

	if (plan.length === 0) return null;

	const miniIndicator = (
		<div className="flex items-center gap-2">
			<PlanProgressBar counts={counts} size="mini" />
			<span className="text-muted-foreground text-xs tabular-nums">
				{counts.completed}/{counts.total}
			</span>
		</div>
	);

	if (isMobile) {
		return (
			<>
				<button
					type="button"
					onClick={() => setSheetOpen(true)}
					className="flex items-center"
				>
					{miniIndicator}
				</button>
				<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
					<SheetContent side="bottom" className="max-h-[50vh]">
						<SheetHeader>
							<SheetTitle className="sr-only">Plan</SheetTitle>
						</SheetHeader>
						<div className="px-4 pb-4">
							<PlanDetailContent entries={plan} />
						</div>
					</SheetContent>
				</Sheet>
			</>
		);
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button type="button" className="flex items-center">
					{miniIndicator}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80">
				<PlanDetailContent entries={plan} />
			</PopoverContent>
		</Popover>
	);
}
