import {
	Add01Icon,
	ArrowDown01Icon,
	ArrowRight01Icon,
	Loading03Icon,
	MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@mobvibe/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@mobvibe/ui/dropdown-menu";
import { Input } from "@mobvibe/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@mobvibe/ui/tooltip";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceList } from "@/components/workspace/WorkspaceList";
import type {
	SidebarSessionListEntry,
	TeamSessionListEntry,
	TeamSessionMemberEntry,
} from "@/hooks/useSessionList";
import { type SessionListEntry } from "@/lib/chat-store";
import { getBackendCapability, useMachinesStore } from "@/lib/machines-store";
import { compareSessionsByRecency } from "@/lib/session-order";
import {
	getSessionDisplayStatus,
	type SessionDisplayPhase,
	type SessionMutationsSnapshot,
} from "@/lib/session-utils";
import { useUiStore } from "@/lib/ui-store";
import { formatRelativeTime, getPathBasename } from "@/lib/ui-utils";
import { cn } from "@/lib/utils";

const DEFAULT_VISIBLE_SESSION_COUNT = 8;

const getSessionStamp = (session: SessionListEntry) =>
	session.updatedAt ?? session.createdAt ?? "";

/** Map display status to a colored dot style */
const statusDotClass: Record<SessionDisplayPhase, string> = {
	active: "bg-green-500",
	loading: "bg-blue-500 animate-pulse",
	error: "bg-red-500",
	detached: "bg-yellow-500",
	history: "bg-muted-foreground/40",
	creating: "bg-purple-500 animate-pulse",
};

/** Return a human-readable tooltip for statuses that carry extra info */
function getStatusTooltip(
	session: SessionListEntry,
	status: SessionDisplayPhase,
	t: (key: string) => string,
): string | null {
	if (status === "error" && session.error?.message) {
		return `${t("session.status.error")}: ${session.error.message}`;
	}
	if (status === "detached" && session.detachedReason) {
		return `${t("session.status.detached")}: ${session.detachedReason}`;
	}
	return t(`session.status.${status}`);
}

type SessionSidebarProps = {
	sessions: SessionListEntry[];
	sidebarEntries?: SidebarSessionListEntry[];
	activeSessionId?: string;
	activeAgentTeamId?: string;
	onCreateSession: (mode: "workspace" | "session" | "agent-team") => void;
	onSelectSession: (sessionId: string) => void;
	onSelectAgentTeam?: (agentTeamId: string) => void;
	onEditSubmit: () => void;
	onCloseSessionRequest: (sessionId: string) => void;
	onDeleteSessionRequest: (sessionId: string) => void;
	onArchiveSessionRequest: (sessionId: string) => void;
	onArchiveAllSessionsRequest: (sessionIds: string[]) => void;
	isBulkArchiving?: boolean;
	deletingSessionId?: string;
	isCreating: boolean;
	mutations: SessionMutationsSnapshot;
};

export const SessionSidebar = ({
	sessions,
	sidebarEntries,
	activeSessionId,
	activeAgentTeamId,
	onCreateSession,
	onSelectSession,
	onSelectAgentTeam,
	onEditSubmit,
	onCloseSessionRequest,
	onDeleteSessionRequest,
	onArchiveSessionRequest,
	onArchiveAllSessionsRequest,
	isBulkArchiving,
	deletingSessionId,
	isCreating,
	mutations,
}: SessionSidebarProps) => {
	const { t } = useTranslation();
	const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
		{},
	);
	const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>(
		{},
	);
	const [showAllSessions, setShowAllSessions] = useState(false);
	const sidebarTabsId = useId();
	const workspacesTabRef = useRef<HTMLButtonElement>(null);
	const sessionsTabRef = useRef<HTMLButtonElement>(null);
	const workspacesTabId = `${sidebarTabsId}-workspaces-tab`;
	const sessionsTabId = `${sidebarTabsId}-sessions-tab`;
	const workspacesPanelId = `${sidebarTabsId}-workspaces-panel`;
	const sessionsPanelId = `${sidebarTabsId}-sessions-panel`;
	const {
		editingSessionId,
		editingTitle,
		startEditingSession,
		setEditingTitle,
		clearEditingSession,
		sidebarTab,
		setSidebarTab,
		selectedWorkspaceByMachine,
	} = useUiStore();
	const { machines, selectedMachineId } = useMachinesStore();

	// Current workspace label for header display
	const currentWorkspace = useMemo(() => {
		if (!selectedMachineId) return null;
		const cwd = selectedWorkspaceByMachine[selectedMachineId];
		if (!cwd) return null;
		return { label: getPathBasename(cwd) ?? cwd };
	}, [selectedMachineId, selectedWorkspaceByMachine]);

	const listEntries = useMemo<SidebarSessionListEntry[]>(
		() =>
			sidebarEntries ??
			sessions.map((session) => ({
				kind: "session",
				session,
			})),
		[sidebarEntries, sessions],
	);

	const teamEntries = useMemo(
		() => listEntries.filter((entry) => entry.kind === "agent-team"),
		[listEntries],
	);

	const ordinarySessions = useMemo(
		() =>
			listEntries.flatMap((entry) =>
				entry.kind === "session" ? [entry.session] : [],
			),
		[listEntries],
	);

	const groupedSessions = useMemo(() => {
		const groups = new Map<
			string,
			{
				id: string;
				label: string;
				sessions: SessionListEntry[];
			}
		>();

		for (const session of ordinarySessions) {
			const id = session.backendId?.trim() || "unknown";
			const rawLabel = session.backendLabel ?? session.backendId ?? "";
			const label = rawLabel.trim().length > 0 ? rawLabel : t("common.unknown");
			const existing = groups.get(id);
			if (!existing) {
				groups.set(id, {
					id,
					label,
					sessions: [session],
				});
				continue;
			}
			existing.sessions.push(session);
		}

		const grouped = Array.from(groups.values());
		for (const group of grouped) {
			group.sessions.sort(compareSessionsByRecency);
		}

		return grouped.sort((left, right) => {
			const byRecent = compareSessionsByRecency(
				left.sessions[0],
				right.sessions[0],
			);
			if (byRecent !== 0) {
				return byRecent;
			}
			return left.label.localeCompare(right.label);
		});
	}, [ordinarySessions, t]);

	const hiddenSessionCount = Math.max(
		ordinarySessions.length - DEFAULT_VISIBLE_SESSION_COUNT,
		0,
	);

	const handleToggleShowAllSessions = () => {
		if (!showAllSessions) {
			setExpandedGroups({});
		}
		setShowAllSessions((prev) => !prev);
	};

	const focusSidebarTab = (tab: "workspaces" | "sessions") => {
		setSidebarTab(tab);
		const targetRef = tab === "workspaces" ? workspacesTabRef : sessionsTabRef;
		targetRef.current?.focus();
	};

	const handleSidebarTabKeyDown = (
		event: React.KeyboardEvent<HTMLButtonElement>,
	) => {
		let nextTab: "workspaces" | "sessions" | undefined;
		if (event.key === "Home") {
			nextTab = "workspaces";
		} else if (event.key === "End") {
			nextTab = "sessions";
		} else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			nextTab = sidebarTab === "workspaces" ? "sessions" : "workspaces";
		}
		if (!nextTab) {
			return;
		}
		event.preventDefault();
		focusSidebarTab(nextTab);
	};

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
				{/* Header: tab switcher + creation actions */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-1">
						<div
							role="tablist"
							aria-label={t("layout.sidebarViews")}
							className="flex items-center gap-1"
						>
							<button
								ref={workspacesTabRef}
								id={workspacesTabId}
								type="button"
								role="tab"
								aria-selected={sidebarTab === "workspaces"}
								aria-controls={workspacesPanelId}
								tabIndex={sidebarTab === "workspaces" ? 0 : -1}
								className={cn(
									"rounded-md px-2 py-1 text-sm",
									sidebarTab === "workspaces"
										? "bg-accent font-semibold"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setSidebarTab("workspaces")}
								onKeyDown={handleSidebarTabKeyDown}
							>
								{t("workspace.title")}
							</button>
							<button
								ref={sessionsTabRef}
								id={sessionsTabId}
								type="button"
								role="tab"
								aria-selected={sidebarTab === "sessions"}
								aria-controls={sessionsPanelId}
								tabIndex={sidebarTab === "sessions" ? 0 : -1}
								className={cn(
									"rounded-md px-2 py-1 text-sm",
									sidebarTab === "sessions"
										? "bg-accent font-semibold"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setSidebarTab("sessions")}
								onKeyDown={handleSidebarTabKeyDown}
							>
								{t("session.title")}
							</button>
						</div>
						<Button
							onClick={() =>
								onCreateSession(
									sidebarTab === "workspaces" ? "workspace" : "session",
								)
							}
							size="icon-sm"
							disabled={isCreating}
							aria-label={
								sidebarTab === "workspaces"
									? t("workspace.new")
									: t("session.new")
							}
							className="ml-auto"
						>
							<HugeiconsIcon
								icon={isCreating ? Loading03Icon : Add01Icon}
								strokeWidth={2}
								className={cn(isCreating && "animate-spin")}
								aria-hidden="true"
							/>
						</Button>
					</div>
					{sidebarTab === "sessions" ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={isCreating}
							className="w-full"
							onClick={() => onCreateSession("agent-team")}
						>
							{t("agentTeam.new")}
						</Button>
					) : null}
				</div>

				{/* Workspaces tab */}
				<div
					id={workspacesPanelId}
					role="tabpanel"
					aria-labelledby={workspacesTabId}
					hidden={sidebarTab !== "workspaces"}
					className={cn(
						"min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
						sidebarTab === "workspaces" ? "flex" : "hidden",
					)}
				>
					{sidebarTab === "workspaces" ? (
						selectedMachineId ? (
							<WorkspaceList
								machineId={selectedMachineId}
								onEmptyCreateSession={() => onCreateSession("workspace")}
							/>
						) : (
							<div className="text-muted-foreground text-xs">
								{t("workspace.empty")}
							</div>
						)
					) : null}
				</div>

				{/* Sessions tab */}
				<div
					id={sessionsPanelId}
					role="tabpanel"
					aria-labelledby={sessionsTabId}
					hidden={sidebarTab !== "sessions"}
					className={cn(
						"min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
						sidebarTab === "sessions" ? "flex" : "hidden",
					)}
				>
					{sidebarTab === "sessions" ? (
						<>
							{listEntries.length === 0 ? (
								<div className="text-muted-foreground text-xs">
									{t("session.empty")}
								</div>
							) : null}
							{teamEntries.length > 0 ? (
								<div className="text-muted-foreground px-1 text-xs font-semibold">
									{t("agentTeam.title")}
								</div>
							) : null}
							{teamEntries.map((entry) => {
								const isExpanded =
									expandedTeams[entry.team.agentTeamId] ??
									entry.team.agentTeamId === activeAgentTeamId;
								return (
									<TeamListItem
										key={entry.team.agentTeamId}
										entry={entry}
										isActive={entry.team.agentTeamId === activeAgentTeamId}
										isExpanded={isExpanded}
										onSelectTeam={() =>
											onSelectAgentTeam?.(entry.team.agentTeamId)
										}
										onToggleExpanded={() =>
											setExpandedTeams((prev) => ({
												...prev,
												[entry.team.agentTeamId]: !(
													prev[entry.team.agentTeamId] ??
													entry.team.agentTeamId === activeAgentTeamId
												),
											}))
										}
										onSelectSession={onSelectSession}
									/>
								);
							})}
							{ordinarySessions.length > 0 && currentWorkspace ? (
								<div className="rounded-md bg-muted/50 px-2.5 py-1.5">
									<span className="text-sm font-semibold">
										{currentWorkspace.label}
									</span>
								</div>
							) : null}
							{(() => {
								let visibleSessionBudget = showAllSessions
									? Number.POSITIVE_INFINITY
									: DEFAULT_VISIBLE_SESSION_COUNT;

								return groupedSessions.map((group) => {
									const isExpanded = expandedGroups[group.id] ?? true;
									const visibleSessions =
										showAllSessions || !isExpanded
											? group.sessions
											: group.sessions.slice(0, visibleSessionBudget);
									if (!showAllSessions && isExpanded) {
										visibleSessionBudget -= visibleSessions.length;
									}
									if (visibleSessions.length === 0) {
										return null;
									}

									return (
										<div key={group.id} className="flex flex-col gap-1">
											<div className="flex items-center justify-between">
												<button
													type="button"
													className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-semibold"
													aria-expanded={isExpanded}
													onClick={() =>
														setExpandedGroups((prev) => ({
															...prev,
															[group.id]: !(prev[group.id] ?? true),
														}))
													}
												>
													<HugeiconsIcon
														icon={
															isExpanded ? ArrowDown01Icon : ArrowRight01Icon
														}
														strokeWidth={2}
														className="h-3.5 w-3.5 shrink-0"
														aria-hidden="true"
													/>
													<span className="truncate">
														{group.label}
														<span className="ml-1 opacity-50">
															({group.sessions.length})
														</span>
													</span>
												</button>
												{isExpanded && group.sessions.length > 1 ? (
													<Button
														size="xs"
														variant="ghost"
														className="text-muted-foreground h-5 px-1.5 text-[10px]"
														disabled={isBulkArchiving}
														onClick={() =>
															onArchiveAllSessionsRequest(
																group.sessions.map((s) => s.sessionId),
															)
														}
													>
														{t("session.archiveAll")}
													</Button>
												) : null}
											</div>
											{isExpanded ? (
												<div className="flex flex-col gap-0.5 pl-2">
													{visibleSessions.map((session) => (
														<SessionListItem
															key={session.sessionId}
															session={session}
															isActive={session.sessionId === activeSessionId}
															isEditing={session.sessionId === editingSessionId}
															editingTitle={editingTitle}
															displayStatus={getSessionDisplayStatus(
																session,
																mutations,
															)}
															onSelect={onSelectSession}
															onEdit={() =>
																startEditingSession(
																	session.sessionId,
																	session.title,
																)
															}
															onEditCancel={clearEditingSession}
															onEditSubmit={onEditSubmit}
															onEditingTitleChange={setEditingTitle}
															onClose={
																session.isAttached === true &&
																getBackendCapability(
																	session.machineId
																		? machines[session.machineId]
																		: undefined,
																	session.backendId,
																	"close",
																) === true
																	? () =>
																			onCloseSessionRequest(session.sessionId)
																	: undefined
															}
															onArchive={() =>
																onArchiveSessionRequest(session.sessionId)
															}
															onDelete={
																getBackendCapability(
																	session.machineId
																		? machines[session.machineId]
																		: undefined,
																	session.backendId,
																	"delete",
																) === true
																	? () =>
																			onDeleteSessionRequest(session.sessionId)
																	: undefined
															}
															isDeleting={
																deletingSessionId === session.sessionId
															}
														/>
													))}
												</div>
											) : null}
										</div>
									);
								});
							})()}
							{hiddenSessionCount > 0 ? (
								<Button
									type="button"
									size="sm"
									variant="ghost"
									className="text-muted-foreground mt-1 justify-start px-2 text-xs"
									onClick={handleToggleShowAllSessions}
								>
									{showAllSessions
										? t("session.showLess")
										: t("session.showMore", { count: hiddenSessionCount })}
								</Button>
							) : null}
						</>
					) : null}
				</div>
			</div>
		</TooltipProvider>
	);
};

type TeamListItemProps = {
	entry: TeamSessionListEntry;
	isActive: boolean;
	isExpanded: boolean;
	onSelectTeam: () => void;
	onToggleExpanded: () => void;
	onSelectSession: (sessionId: string) => void;
};

const countTasks = (entry: TeamSessionListEntry) =>
	entry.team.taskCounts.todo +
	entry.team.taskCounts.inProgress +
	entry.team.taskCounts.blocked +
	entry.team.taskCounts.completed +
	entry.team.taskCounts.failed +
	entry.team.taskCounts.cancelled;

const countMail = (entry: TeamSessionListEntry) =>
	entry.team.mailboxCounts.unread +
	entry.team.mailboxCounts.wakePending +
	entry.team.mailboxCounts.wakeFailed;

const getMemberMcpPhase = (entry: TeamSessionListEntry) =>
	entry.members.find((member) => member.mcp)?.mcp?.phase;

const TeamListItem = ({
	entry,
	isActive,
	isExpanded,
	onSelectTeam,
	onToggleExpanded,
	onSelectSession,
}: TeamListItemProps) => {
	const { t, i18n } = useTranslation();
	const stamp = entry.updatedAt ?? entry.team.updatedAt ?? entry.team.createdAt;
	const relativeTime = stamp
		? formatRelativeTime(stamp, {
				locale: i18n.resolvedLanguage ?? i18n.language,
				justNow: t("time.justNow"),
			})
		: null;
	const mcpPhase = getMemberMcpPhase(entry);

	return (
		<div className="flex flex-col gap-0.5">
			<div
				className={cn(
					"group/team relative flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
					isActive
						? "bg-accent border-l-primary border-l-2"
						: "hover:bg-muted/50",
				)}
			>
				<button
					type="button"
					aria-label={t("agentTeam.toggleMembers", {
						title: entry.team.title,
					})}
					aria-expanded={isExpanded}
					className="text-muted-foreground hover:text-foreground mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md focus-visible:ring-1 focus-visible:ring-ring/50"
					onClick={onToggleExpanded}
				>
					<HugeiconsIcon
						icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
						strokeWidth={2}
						className="h-3.5 w-3.5"
						aria-hidden="true"
					/>
				</button>
				<button
					type="button"
					aria-current={isActive ? "page" : undefined}
					className="flex min-w-0 flex-1 flex-col gap-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
					onClick={onSelectTeam}
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-sm font-semibold">
							{entry.team.title}
						</span>
						<span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
							{t("agentTeam.badge")}
						</span>
					</span>
					<span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-tight">
						<span>{entry.team.lifecycle}</span>
						{mcpPhase ? (
							<>
								<span className="opacity-50">&middot;</span>
								<span>{mcpPhase}</span>
							</>
						) : null}
						{relativeTime ? (
							<>
								<span className="opacity-50">&middot;</span>
								<span>{relativeTime}</span>
							</>
						) : null}
					</span>
					<span className="flex flex-wrap gap-1">
						<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							{t("agentTeam.taskBadge", { count: countTasks(entry) })}
						</span>
						<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							{t("agentTeam.mailBadge", { count: countMail(entry) })}
						</span>
					</span>
				</button>
			</div>
			{isExpanded ? (
				<div className="ml-7 flex flex-col gap-0.5 border-l border-border/70 pl-2">
					{entry.members.map((member) => (
						<TeamMemberListItem
							key={member.memberId}
							member={member}
							onSelectSession={onSelectSession}
						/>
					))}
				</div>
			) : null}
		</div>
	);
};

type TeamMemberListItemProps = {
	member: TeamSessionMemberEntry;
	onSelectSession: (sessionId: string) => void;
};

const TeamMemberListItem = ({
	member,
	onSelectSession,
}: TeamMemberListItemProps) => {
	const { t } = useTranslation();
	const metadata = [member.role, member.backendId, member.lifecycle]
		.filter(Boolean)
		.join(" · ");
	const branch = member.worktreeBranch ?? member.session?.worktreeBranch;
	const hasSession = Boolean(member.session);

	return (
		<button
			type="button"
			disabled={!hasSession}
			className="flex min-h-10 min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
			onClick={() => {
				if (member.sessionId) {
					onSelectSession(member.sessionId);
				}
			}}
		>
			<span className="truncate text-sm font-medium">{member.name}</span>
			<span className="text-muted-foreground truncate text-xs leading-tight">
				{metadata}
				{branch ? (
					<span className="ml-1 inline-flex items-center gap-0.5">
						<span className="opacity-50">&middot;</span>
						<span>{branch}</span>
					</span>
				) : null}
				<span className="ml-1 inline-flex items-center gap-0.5">
					<span className="opacity-50">&middot;</span>
					<span>
						{hasSession ? t("agentTeam.linked") : t("agentTeam.noSession")}
					</span>
				</span>
			</span>
		</button>
	);
};

type SessionListItemProps = {
	session: SessionListEntry;
	isActive: boolean;
	isEditing: boolean;
	editingTitle: string;
	displayStatus: SessionDisplayPhase;
	onSelect: (sessionId: string) => void;
	onEdit: () => void;
	onEditCancel: () => void;
	onEditSubmit: () => void;
	onEditingTitleChange: (value: string) => void;
	onClose?: () => void;
	onArchive: () => void;
	onDelete?: () => void;
	isDeleting: boolean;
};

const SessionListItem = ({
	session,
	isActive,
	isEditing,
	editingTitle,
	displayStatus,
	onSelect,
	onEdit,
	onEditCancel,
	onEditSubmit,
	onEditingTitleChange,
	onClose,
	onArchive,
	onDelete,
	isDeleting,
}: SessionListItemProps) => {
	const { t, i18n } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const handleSelect = () => onSelect(session.sessionId);

	const statusTooltip = getStatusTooltip(session, displayStatus, t);

	// Relative time from session timestamp
	const stamp = getSessionStamp(session);
	const relativeTime = stamp
		? formatRelativeTime(stamp, {
				locale: i18n.resolvedLanguage ?? i18n.language,
				justNow: t("time.justNow"),
			})
		: null;

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		event.stopPropagation();
		if (event.key === "Enter") {
			onEditSubmit();
		} else if (event.key === "Escape") {
			onEditCancel();
		}
	};

	const isCreating = displayStatus === "creating";

	return (
		<div
			className={cn(
				"group/session relative flex items-start gap-2 rounded-md px-2 py-1.5 pr-10 text-left transition-colors",
				isActive
					? "bg-accent border-l-primary border-l-2"
					: "hover:bg-muted/50",
				isCreating && "bg-muted/30",
			)}
		>
			{/* Status dot */}
			<Tooltip>
				<TooltipTrigger asChild>
					<span
						className={cn(
							"mt-1.5 h-2 w-2 shrink-0 rounded-full",
							statusDotClass[displayStatus],
						)}
						aria-hidden="true"
						title={statusTooltip ?? undefined}
					/>
				</TooltipTrigger>
				{statusTooltip ? (
					<TooltipContent side="right">
						<span className="text-xs">{statusTooltip}</span>
					</TooltipContent>
				) : null}
			</Tooltip>

			{/* Content area */}
			<button
				type="button"
				onClick={handleSelect}
				disabled={isCreating}
				className="flex min-w-0 flex-1 flex-col gap-0.5 pr-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
			>
				{/* Title row */}
				{isEditing ? (
					<Input
						ref={inputRef}
						aria-label={t("session.titleLabel")}
						name="session-title"
						autoComplete="off"
						autoFocus
						value={editingTitle}
						onChange={(event) => onEditingTitleChange(event.target.value)}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={handleKeyDown}
						className="h-6 text-xs"
					/>
				) : (
					<span className="truncate text-sm font-medium leading-tight">
						{session.title}
					</span>
				)}

				{/* Metadata row: relative time · branch · e2ee badge */}
				<span className="text-muted-foreground truncate text-xs leading-tight">
					{relativeTime}
					{session.worktreeBranch ? (
						<span className="ml-1 inline-flex items-center gap-0.5">
							<span className="opacity-50">&middot;</span>
							<span>{session.worktreeBranch}</span>
						</span>
					) : null}
					{session.e2eeStatus === "missing_key" ? (
						<span className="ml-1 inline-flex items-center gap-0.5">
							<span className="opacity-50">&middot;</span>
							<span className="text-warning">{t("e2ee.missingKeyBadge")}</span>
						</span>
					) : null}
				</span>
			</button>

			{/* Three-dot menu */}
			{!isEditing && !isCreating ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							size="icon-sm"
							variant="ghost"
							className={cn(
								"absolute top-1.5 right-1 h-7 w-7 shrink-0 rounded-none text-muted-foreground/80 opacity-100 transition-colors",
								"hover:text-foreground focus-visible:text-foreground group-hover/session:text-foreground data-[state=open]:text-foreground",
								isActive && "text-foreground",
							)}
							onClick={(event) => event.stopPropagation()}
							aria-label={t("session.actions", { title: session.title })}
						>
							<HugeiconsIcon
								icon={MoreHorizontalIcon}
								strokeWidth={2}
								className="h-3.5 w-3.5"
								aria-hidden="true"
							/>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="z-[70] w-36">
						<DropdownMenuItem onClick={onEdit}>
							{t("common.rename")}
						</DropdownMenuItem>
						{onClose ? (
							<DropdownMenuItem onClick={onClose}>
								{t("common.close")}
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem onClick={onArchive}>
							{t("common.archive")}
						</DropdownMenuItem>
						{onDelete ? (
							<DropdownMenuItem
								variant="destructive"
								disabled={isDeleting}
								onClick={onDelete}
							>
								{isDeleting ? t("session.deleting") : t("common.delete")}
							</DropdownMenuItem>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
};
