import type { AgentTeamSummary, TeamMemberSummary } from "@mobvibe/shared";
import { Button } from "@mobvibe/ui/button";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type AgentTeamOverviewProps = {
	team: AgentTeamSummary;
	onSelectSession: (sessionId: string) => void;
};

const countTasks = (counts: AgentTeamSummary["taskCounts"]) =>
	counts.todo +
	counts.inProgress +
	counts.blocked +
	counts.completed +
	counts.failed +
	counts.cancelled;

const countMail = (counts: AgentTeamSummary["mailboxCounts"]) =>
	counts.unread + counts.wakePending + counts.wakeFailed;

const memberTaskCount = (member: TeamMemberSummary) =>
	member.taskCounts.todo +
	member.taskCounts.inProgress +
	member.taskCounts.blocked +
	member.taskCounts.completed +
	member.taskCounts.failed +
	member.taskCounts.cancelled;

const memberMailCount = (member: TeamMemberSummary) =>
	member.mailboxCounts.unread +
	member.mailboxCounts.wakePending +
	member.mailboxCounts.wakeFailed;

export function AgentTeamOverview({
	team,
	onSelectSession,
}: AgentTeamOverviewProps) {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
			<section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
				<div className="rounded-xl border bg-background/80 p-4 shadow-sm md:p-5">
					<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
						<div className="min-w-0">
							<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
								{t("agentTeam.badge")}
							</p>
							<h1 className="mt-1 truncate text-2xl font-semibold">
								{team.title}
							</h1>
							<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
								<span className="rounded-full bg-muted px-2 py-1">
									{team.lifecycle}
								</span>
								<span className="rounded-full bg-muted px-2 py-1">
									{team.workspaceRootCwd}
								</span>
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							<span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
								{t("agentTeam.taskBadge", {
									count: countTasks(team.taskCounts),
								})}
							</span>
							<span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
								{t("agentTeam.mailBadge", {
									count: countMail(team.mailboxCounts),
								})}
							</span>
						</div>
					</div>
					{team.error?.message ? (
						<div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{team.error.message}
						</div>
					) : null}
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					{team.members.map((member) => (
						<MemberCard
							key={member.memberId}
							member={member}
							onSelectSession={onSelectSession}
						/>
					))}
				</div>
			</section>
		</div>
	);
}

function MemberCard({
	member,
	onSelectSession,
}: {
	member: TeamMemberSummary;
	onSelectSession: (sessionId: string) => void;
}) {
	const { t } = useTranslation();
	const hasSession = Boolean(member.sessionId);
	return (
		<article className="rounded-xl border bg-background/80 p-4 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="truncate text-base font-semibold">{member.name}</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{member.role} · {member.backendId} · {member.lifecycle}
					</p>
				</div>
				<span
					className={cn(
						"rounded-full px-2 py-1 text-xs font-medium",
						member.health === "error"
							? "bg-destructive/10 text-destructive"
							: "bg-muted text-muted-foreground",
					)}
				>
					{member.health}
				</span>
			</div>

			<div className="mt-3 grid gap-2 text-sm text-muted-foreground">
				{member.mcp ? (
					<div>{`${member.mcp.phase} · ${member.mcp.transport}`}</div>
				) : null}
				{member.worktreeBranch ? <div>{member.worktreeBranch}</div> : null}
				<div className="flex flex-wrap gap-2 text-xs">
					<span className="rounded-full bg-muted px-2 py-1">
						{t("agentTeam.taskBadge", { count: memberTaskCount(member) })}
					</span>
					<span className="rounded-full bg-muted px-2 py-1">
						{t("agentTeam.mailBadge", { count: memberMailCount(member) })}
					</span>
				</div>
				{member.error?.message ? (
					<div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{member.error.message}
					</div>
				) : null}
			</div>

			<div className="mt-4">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!hasSession}
					onClick={() => {
						if (member.sessionId) {
							onSelectSession(member.sessionId);
						}
					}}
				>
					{t("agentTeam.openMemberSession", { name: member.name })}
				</Button>
			</div>
		</article>
	);
}
