import {
	Add01Icon,
	ArrowDown01Icon,
	ArrowRight01Icon,
	Loading03Icon,
	MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceList } from "@/components/workspace/WorkspaceList";
import { type SessionListEntry } from "@/lib/chat-store";
import { useMachinesStore } from "@/lib/machines-store";
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
	activeSessionId?: string;
	onCreateSession: (mode: "workspace" | "session") => void;
	onSelectSession: (sessionId: string) => void;
	onEditSubmit: () => void;
	onArchiveSessionRequest: (sessionId: string) => void;
	onArchiveAllSessionsRequest: (sessionIds: string[]) => void;
	isBulkArchiving?: boolean;
	isCreating: boolean;
	mutations: SessionMutationsSnapshot;
};

export const SessionSidebar = ({
	sessions,
	activeSessionId,
	onCreateSession,
	onSelectSession,
	onEditSubmit,
	onArchiveSessionRequest,
	onArchiveAllSessionsRequest,
	isBulkArchiving,
	isCreating,
	mutations,
}: SessionSidebarProps) => {
	const { t } = useTranslation();
	const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
		{},
	);
	const [showAllSessions, setShowAllSessions] = useState(false);
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
	const { selectedMachineId } = useMachinesStore();

	// Current workspace label for header display
	const currentWorkspace = useMemo(() => {
		if (!selectedMachineId) return null;
		const cwd = selectedWorkspaceByMachine[selectedMachineId];
		if (!cwd) return null;
		return { label: getPathBasename(cwd) ?? cwd };
	}, [selectedMachineId, selectedWorkspaceByMachine]);

	const groupedSessions = useMemo(() => {
		const groups = new Map<
			string,
			{
				id: string;
				label: string;
				sessions: SessionListEntry[];
			}
		>();

		for (const session of sessions) {
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
	}, [sessions, t]);

	const hiddenSessionCount = Math.max(
		sessions.length - DEFAULT_VISIBLE_SESSION_COUNT,
		0,
	);

	const handleToggleShowAllSessions = () => {
		if (!showAllSessions) {
			setExpandedGroups({});
		}
		setShowAllSessions((prev) => !prev);
	};

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
				{/* Header: Tab switcher + New button */}
				<div className="flex items-center gap-1">
					<button
						type="button"
						className={cn(
							"rounded-md px-2 py-1 text-sm",
							sidebarTab === "workspaces"
								? "bg-accent font-semibold"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => setSidebarTab("workspaces")}
					>
						{t("workspace.title")}
					</button>
					<button
						type="button"
						className={cn(
							"rounded-md px-2 py-1 text-sm",
							sidebarTab === "sessions"
								? "bg-accent font-semibold"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => setSidebarTab("sessions")}
					>
						{t("session.title")}
					</button>
					<Button
						onClick={() =>
							onCreateSession(
								sidebarTab === "workspaces" ? "workspace" : "session",
							)
						}
						size="icon-sm"
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
						/>
					</Button>
				</div>

				{/* Workspaces tab */}
				{sidebarTab === "workspaces" ? (
					<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
						{selectedMachineId ? (
							<WorkspaceList
								machineId={selectedMachineId}
								onEmptyCreateSession={() => onCreateSession("workspace")}
							/>
						) : (
							<div className="text-muted-foreground text-xs">
								{t("workspace.empty")}
							</div>
						)}
					</div>
				) : null}

				{/* Sessions tab */}
				{sidebarTab === "sessions" ? (
					<>
						{/* Current workspace indicator */}
						{currentWorkspace ? (
							<div className="rounded-md bg-muted/50 px-2.5 py-1.5">
								<span className="text-sm font-semibold">
									{currentWorkspace.label}
								</span>
							</div>
						) : null}

						{/* Session list */}
						<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
							{sessions.length === 0 ? (
								<div className="text-muted-foreground text-xs">
									{t("session.empty")}
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
															onArchive={() =>
																onArchiveSessionRequest(session.sessionId)
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
						</div>
					</>
				) : null}
			</div>
		</TooltipProvider>
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
	onArchive: () => void;
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
	onArchive,
}: SessionListItemProps) => {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const handleSelect = () => onSelect(session.sessionId);

	const statusTooltip = getStatusTooltip(session, displayStatus, t);

	// Relative time from session timestamp
	const stamp = getSessionStamp(session);
	const relativeTime = stamp ? formatRelativeTime(stamp) : null;

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
						aria-label="Session title"
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
						>
							<HugeiconsIcon
								icon={MoreHorizontalIcon}
								strokeWidth={2}
								className="h-3.5 w-3.5"
							/>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="z-[70] w-36">
						<DropdownMenuItem onClick={onEdit}>
							{t("common.rename")}
						</DropdownMenuItem>
						<DropdownMenuItem variant="destructive" onClick={onArchive}>
							{t("common.archive")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
};
