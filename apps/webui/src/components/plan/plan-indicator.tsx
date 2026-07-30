import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@mobvibe/ui/badge";
import { Button } from "@mobvibe/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@mobvibe/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@mobvibe/ui/popover";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@mobvibe/ui/sheet";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StreamdownProps } from "streamdown";
import { LazyStreamdown } from "@/components/chat/LazyStreamdown";
import { useIsMobile } from "@/hooks/use-mobile";
import type {
	PlanEntry,
	PlanEntryPriority,
	PlanEntryStatus,
	PlanUpdateContent,
} from "@/lib/acp";
import { cn } from "@/lib/utils";

const PLAN_COMPONENTS: NonNullable<StreamdownProps["components"]> = {
	a: ({ children }) => (
		<span className="break-words [overflow-wrap:anywhere]">{children}</span>
	),
	img: ({ alt }) =>
		alt ? (
			<span className="break-words [overflow-wrap:anywhere]">{alt}</span>
		) : null,
	code: ({ children }) => (
		<code className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
			{children}
		</code>
	),
	pre: ({ children }) => (
		<pre className="overflow-x-auto whitespace-pre-wrap">{children}</pre>
	),
};
const PLAN_REHYPE_PLUGINS: NonNullable<StreamdownProps["rehypePlugins"]> = [];
const PLAN_REMARK_REHYPE_OPTIONS: NonNullable<
	StreamdownProps["remarkRehypeOptions"]
> = { allowDangerousHtml: false };
const PLAN_STREAMDOWN_PROPS = {
	mode: "static",
	parseIncompleteMarkdown: false,
	controls: false,
	cdnUrl: null,
	components: PLAN_COMPONENTS,
	remarkRehypeOptions: PLAN_REMARK_REHYPE_OPTIONS,
	rehypePlugins: PLAN_REHYPE_PLUGINS,
} satisfies Omit<StreamdownProps, "children">;

type PlanStatusCounts = {
	completed: number;
	inProgress: number;
	pending: number;
	total: number;
};
const EMPTY_PLAN_STATUS_COUNTS: PlanStatusCounts = {
	completed: 0,
	inProgress: 0,
	pending: 0,
	total: 0,
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
			return "bg-amber-500 motion-safe:animate-pulse";
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

function PlanProgressBar({
	counts,
	size,
}: {
	counts: PlanStatusCounts;
	size: "mini" | "full";
}) {
	const { t } = useTranslation();
	const { total, completed, inProgress } = counts;
	if (total === 0) return null;

	const completedPct = (completed / total) * 100;
	const inProgressPct = (inProgress / total) * 100;
	const statusSummary = [
		t("plan.summaryCompleted", { count: counts.completed }),
		t("plan.summaryInProgress", { count: counts.inProgress }),
		t("plan.summaryPending", { count: counts.pending }),
	].join(", ");

	return (
		<div
			role="progressbar"
			aria-label={t("plan.completedCount", { completed, total })}
			aria-valuemin={0}
			aria-valuemax={total}
			aria-valuenow={completed}
			aria-valuetext={statusSummary}
			className={cn(
				"overflow-hidden rounded-full bg-muted",
				size === "mini" ? "h-1 w-20" : "h-1.5 w-full",
			)}
		>
			<div className="flex h-full">
				<div
					className="bg-green-600 transition-[width] duration-500 motion-reduce:transition-none"
					style={{ width: `${completedPct}%` }}
				/>
				<div
					className="bg-amber-500 transition-[width] duration-500 motion-reduce:transition-none"
					style={{ width: `${inProgressPct}%` }}
				/>
			</div>
		</div>
	);
}

function SafePlanMarkdown({ children }: { children: string }) {
	return (
		<LazyStreamdown
			{...PLAN_STREAMDOWN_PROPS}
			className="min-w-0 break-words [overflow-wrap:anywhere]"
		>
			{children}
		</LazyStreamdown>
	);
}

function PlanEntryItem({ entry }: { entry: PlanEntry }) {
	const { t } = useTranslation();
	const isLong =
		entry.content.length > 200 || (entry.content.match(/\n/g)?.length ?? 0) > 3;
	const [expanded, setExpanded] = useState(false);
	const statusLabel =
		entry.status === "completed"
			? t("plan.summaryCompleted", { count: 1 })
			: entry.status === "in_progress"
				? t("plan.summaryInProgress", { count: 1 })
				: t("plan.summaryPending", { count: 1 });

	return (
		<div className="flex min-w-0 gap-2 py-1.5">
			<div className="mt-1 shrink-0">
				<div
					aria-hidden="true"
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
						<span className="sr-only">{statusLabel}: </span>
						{isLong && !expanded ? (
							<div className="relative max-h-[4.5rem] overflow-hidden">
								<span className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
									{entry.content}
								</span>
								<div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-popover" />
							</div>
						) : isLong && expanded ? (
							<div className="max-h-60 overflow-x-hidden overflow-y-auto">
								<SafePlanMarkdown>{entry.content}</SafePlanMarkdown>
							</div>
						) : (
							<span className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
								{entry.content}
							</span>
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
						aria-expanded={expanded}
					>
						{expanded ? t("plan.showLess") : t("plan.showMore")}
					</Button>
				)}
			</div>
		</div>
	);
}

function PlanDetailContent({
	entries,
	showHeader = true,
	title,
}: {
	entries: PlanEntry[];
	showHeader?: boolean;
	title?: string;
}) {
	const { t } = useTranslation();
	const counts = countPlanStatuses(entries);
	const inProgressEntries = entries.filter(
		(entry) => entry.status === "in_progress",
	);
	const pendingEntries = entries.filter((entry) => entry.status === "pending");
	const completedEntries = entries.filter(
		(entry) => entry.status === "completed",
	);

	return (
		<div className="space-y-3">
			{showHeader ? (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-sm font-medium">
							{title ?? t("plan.title")}
						</span>
						<span className="text-xs text-muted-foreground">
							{t("plan.completedCount", {
								completed: counts.completed,
								total: counts.total,
							})}
						</span>
					</div>
					<PlanProgressBar counts={counts} size="full" />
					<div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
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
							<span>
								· {t("plan.summaryPending", { count: counts.pending })}
							</span>
						)}
					</div>
				</div>
			) : null}

			{entries.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t("plan.emptyItems")}</p>
			) : null}
			{inProgressEntries.length > 0 && (
				<div className="space-y-0.5">
					{inProgressEntries.map((entry, index) => (
						<PlanEntryItem key={`ip-${index}`} entry={entry} />
					))}
				</div>
			)}
			{pendingEntries.length > 0 && (
				<div className="space-y-0.5">
					{pendingEntries.map((entry, index) => (
						<PlanEntryItem key={`pd-${index}`} entry={entry} />
					))}
				</div>
			)}
			{completedEntries.length > 0 && (
				<Collapsible>
					<CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-sm text-[10px] text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
						<HugeiconsIcon
							icon={ArrowDown01Icon}
							strokeWidth={2}
							className="size-3 group-data-[state=open]:hidden"
							aria-hidden="true"
						/>
						<HugeiconsIcon
							icon={ArrowUp01Icon}
							strokeWidth={2}
							className="size-3 group-data-[state=closed]:hidden"
							aria-hidden="true"
						/>
						{t("plan.completedSection", { count: completedEntries.length })}
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="mt-1 space-y-0.5">
							{completedEntries.map((entry, index) => (
								<PlanEntryItem key={`cp-${index}`} entry={entry} />
							))}
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
}

function PlanProjection({ plan }: { plan: PlanUpdateContent }) {
	const { t } = useTranslation();
	return (
		<section className="min-w-0 space-y-2 overflow-x-hidden border-t pt-3 first:border-t-0 first:pt-0">
			<div className="flex min-w-0 items-center justify-between gap-2">
				<h3 className="min-w-0 text-xs font-medium">
					<span className="sr-only">{t("plan.planId")}: </span>
					<code className="block truncate" dir="auto" translate="no">
						{plan.planId}
					</code>
				</h3>
				<Badge variant="outline" className="shrink-0 text-[10px]">
					{t(`plan.type.${plan.type}`)}
				</Badge>
			</div>
			{plan.type === "items" ? (
				<PlanDetailContent entries={plan.entries} showHeader={false} />
			) : null}
			{plan.type === "markdown" ? (
				plan.content.length > 0 ? (
					<div className="min-w-0 overflow-x-hidden text-xs">
						<SafePlanMarkdown>{plan.content}</SafePlanMarkdown>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">
						{t("plan.emptyMarkdown")}
					</p>
				)
			) : null}
			{plan.type === "file" ? (
				<div className="rounded-md bg-muted px-2 py-1.5 text-xs">
					<code className="block break-all" dir="ltr" translate="no">
						{plan.uri}
					</code>
				</div>
			) : null}
		</section>
	);
}

function CombinedPlanDetail({
	legacyPlan,
	plans,
}: {
	legacyPlan?: PlanEntry[];
	plans: PlanUpdateContent[];
}) {
	const { t } = useTranslation();
	return (
		<div className="max-h-[60vh] min-w-0 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain">
			{legacyPlan && legacyPlan.length > 0 ? (
				<section>
					<PlanDetailContent
						entries={legacyPlan}
						title={t("plan.legacyTitle")}
					/>
				</section>
			) : null}
			{plans.map((plan) => (
				<PlanProjection key={plan.planId} plan={plan} />
			))}
		</div>
	);
}

type PlanIndicatorProps = {
	plan?: PlanEntry[];
	plans?: PlanUpdateContent[];
};

export default function PlanIndicator({
	plan,
	plans = [],
}: PlanIndicatorProps) {
	const { t } = useTranslation();
	const isMobile = useIsMobile();
	const [sheetOpen, setSheetOpen] = useState(false);
	const legacyPlan = plan && plan.length > 0 ? plan : undefined;
	const legacyCounts = legacyPlan ? countPlanStatuses(legacyPlan) : undefined;
	const legacyOnly = Boolean(legacyPlan) && plans.length === 0;
	const planCount = plans.length + (legacyPlan ? 1 : 0);
	if (planCount === 0) return null;

	const miniIndicator = legacyOnly ? (
		<div className="flex items-center gap-2">
			<PlanProgressBar
				counts={legacyCounts ?? EMPTY_PLAN_STATUS_COUNTS}
				size="mini"
			/>
			<span className="text-xs tabular-nums text-muted-foreground">
				{legacyCounts?.completed}/{legacyCounts?.total}
			</span>
		</div>
	) : (
		<span className="text-xs text-muted-foreground">
			{t("plan.plansCount", { count: planCount })}
		</span>
	);
	const detail = legacyOnly ? (
		<div className="max-h-[60vh] min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain">
			<PlanDetailContent entries={legacyPlan ?? []} />
		</div>
	) : (
		<CombinedPlanDetail legacyPlan={legacyPlan} plans={plans} />
	);
	const openLabel = t("plan.openPlans", { count: planCount });

	if (isMobile) {
		return (
			<>
				<button
					type="button"
					onClick={() => setSheetOpen(true)}
					aria-label={openLabel}
					title={openLabel}
					className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-sm px-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{miniIndicator}
				</button>
				<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
					<SheetContent
						side="bottom"
						className="max-h-[70vh] overscroll-contain"
					>
						<SheetHeader>
							<SheetTitle className="sr-only">{t("plan.title")}</SheetTitle>
						</SheetHeader>
						<div className="min-w-0 overflow-x-hidden px-4 pb-4">{detail}</div>
					</SheetContent>
				</Sheet>
			</>
		);
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={openLabel}
					title={openLabel}
					className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-sm px-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{miniIndicator}
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-80 max-w-[calc(100vw-2rem)] overflow-x-hidden"
			>
				{detail}
			</PopoverContent>
		</Popover>
	);
}
