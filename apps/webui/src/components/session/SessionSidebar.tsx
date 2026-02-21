import { Loading01Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ChatSession } from "@/lib/chat-store";
import {
	getSessionDisplayStatus,
	type SessionDisplayPhase,
	type SessionMutationsSnapshot,
} from "@/lib/session-utils";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

const getSessionStamp = (session: ChatSession) =>
	session.updatedAt ?? session.createdAt ?? "";

const getPathBasename = (path?: string) => {
	if (!path) {
		return undefined;
	}
	const trimmed = path.replace(/\/+$/, "");
	if (trimmed.length === 0) {
		return undefined;
	}
	const parts = trimmed.split("/");
	const tail = parts[parts.length - 1];
	return tail && tail.length > 0 ? tail : undefined;
};

type SessionSidebarProps = {
	sessions: ChatSession[];
	activeSessionId?: string;
	onCreateSession: () => void;
	onSelectSession: (sessionId: string) => void;
	onEditSubmit: () => void;
	onArchiveSession: (sessionId: string) => void;
	onArchiveAllSessions: (sessionIds: string[]) => void;
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
	onArchiveSession,
	onArchiveAllSessions,
	isBulkArchiving,
	isCreating,
	mutations,
}: SessionSidebarProps) => {
	const { t } = useTranslation();
	const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
		{},
	);
	const {
		editingSessionId,
		editingTitle,
		startEditingSession,
		setEditingTitle,
		clearEditingSession,
	} = useUiStore();

	const groupedSessions = useMemo(() => {
		const groups = new Map<
			string,
			{
				id: string;
				label: string;
				sessions: ChatSession[];
				latestStamp: string;
			}
		>();

		for (const session of sessions) {
			const id = session.backendId?.trim() || "unknown";
			const rawLabel = session.backendLabel ?? session.backendId ?? "";
			const label = rawLabel.trim().length > 0 ? rawLabel : t("common.unknown");
			const stamp = getSessionStamp(session);
			const existing = groups.get(id);
			if (!existing) {
				groups.set(id, {
					id,
					label,
					sessions: [session],
					latestStamp: stamp,
				});
				continue;
			}
			existing.sessions.push(session);
			if (stamp.localeCompare(existing.latestStamp) > 0) {
				existing.latestStamp = stamp;
			}
		}

		const compareSession = (left: ChatSession, right: ChatSession) =>
			getSessionStamp(right).localeCompare(getSessionStamp(left));

		const grouped = Array.from(groups.values());
		for (const group of grouped) {
			group.sessions.sort(compareSession);
		}

		return grouped.sort((left, right) => {
			const byRecent = right.latestStamp.localeCompare(left.latestStamp);
			if (byRecent !== 0) {
				return byRecent;
			}
			return left.label.localeCompare(right.label);
		});
	}, [sessions, t]);

	return (
		<div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
			<div className="flex items-center justify-between">
				<div className="text-sm font-semibold">{t("session.title")}</div>

				<div className="flex items-center gap-2">
					{sessions.length > 0 ? (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button size="sm" variant="outline" disabled={isBulkArchiving}>
									{t("session.archiveAll")}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent size="sm">
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("session.archiveAllTitle")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t("session.archiveAllDescription", {
											count: sessions.length,
										})}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
									<AlertDialogAction
										onClick={() =>
											onArchiveAllSessions(sessions.map((s) => s.sessionId))
										}
									>
										{t("session.archiveAllConfirm")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					) : null}
					<Button variant="outline" size="icon-sm" asChild>
						<Link to="/settings" aria-label={t("settings.title")}>
							<HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
						</Link>
					</Button>

					<Button onClick={onCreateSession} size="sm" disabled={isCreating}>
						{t("common.new")}
					</Button>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
				{sessions.length === 0 ? (
					<div className="text-muted-foreground text-xs">
						{t("session.empty")}
					</div>
				) : null}
				{groupedSessions.map((group) => {
					const isExpanded = expandedGroups[group.id] ?? true;
					return (
						<div key={group.id} className="flex flex-col gap-2">
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs font-semibold"
								aria-expanded={isExpanded}
								onClick={() =>
									setExpandedGroups((prev) => ({
										...prev,
										[group.id]: !(prev[group.id] ?? true),
									}))
								}
							>
								<span className="w-3 text-center">
									{isExpanded ? "v" : ">"}
								</span>
								<span className="truncate">{group.label}</span>
							</button>
							{isExpanded ? (
								<div className="flex flex-col gap-2 pl-4">
									{group.sessions.map((session) => (
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
												startEditingSession(session.sessionId, session.title)
											}
											onEditCancel={clearEditingSession}
											onEditSubmit={onEditSubmit}
											onEditingTitleChange={setEditingTitle}
											onArchive={onArchiveSession}
										/>
									))}
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
};

type SessionListItemProps = {
	session: ChatSession;
	isActive: boolean;
	isEditing: boolean;
	editingTitle: string;
	displayStatus: SessionDisplayPhase;
	onSelect: (sessionId: string) => void;
	onEdit: () => void;
	onEditCancel: () => void;
	onEditSubmit: () => void;
	onEditingTitleChange: (value: string) => void;
	onArchive: (sessionId: string) => void;
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
	const cwdLabel = getPathBasename(session.cwd) ?? t("common.unknown");
	const handleSelect = () => onSelect(session.sessionId);

	const StatusBadge = () => {
		switch (displayStatus) {
			case "loading":
				return (
					<Badge variant="secondary" className="gap-1">
						<HugeiconsIcon
							icon={Loading01Icon}
							strokeWidth={2}
							className="h-3 w-3 animate-spin"
						/>
						{t("session.status.loading")}
					</Badge>
				);
			case "active":
				return (
					<Badge className="bg-green-600 hover:bg-green-700">
						{t("session.status.active")}
					</Badge>
				);
			case "error":
				return <Badge variant="destructive">{t("session.status.error")}</Badge>;
			case "detached":
				return (
					<Badge variant="outline" className="text-warning border-warning">
						{t("session.status.detached")}
					</Badge>
				);
			case "history":
				return (
					<Badge
						variant="outline"
						className="text-muted-foreground border-muted-foreground/30"
					>
						{t("session.status.history")}
					</Badge>
				);
			default:
				return null;
		}
	};

	return (
		<div
			className={cn(
				"border-border bg-background hover:bg-muted flex flex-col gap-2 rounded-none border p-2 text-left",
				isActive ? "border-primary/40" : "",
			)}
		>
			<button
				type="button"
				onClick={handleSelect}
				className="flex flex-1 flex-col gap-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
			>
				<div className="flex items-center justify-between gap-2">
					{isEditing ? (
						<Input
							aria-label="Session title"
							name="session-title"
							autoComplete="off"
							value={editingTitle}
							onChange={(event) => onEditingTitleChange(event.target.value)}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => event.stopPropagation()}
							className="h-7 text-xs"
						/>
					) : (
						<span className="text-sm font-medium">{session.title}</span>
					)}
					<div className="flex items-center gap-2 shrink-0">
						<StatusBadge />
					</div>
				</div>
				<span className="text-muted-foreground text-xs">{cwdLabel}</span>
				{session.detachedReason ? (
					<span className="text-muted-foreground text-xs">
						{t("status.error")}: {session.detachedReason}
					</span>
				) : null}
				{session.error ? (
					<span className="text-destructive text-xs">
						{session.error.message}
					</span>
				) : null}
			</button>
			<div className="flex items-center gap-2">
				{isEditing ? (
					<>
						<Button size="xs" onClick={onEditSubmit}>
							{t("common.save")}
						</Button>
						<Button size="xs" variant="outline" onClick={onEditCancel}>
							{t("common.cancel")}
						</Button>
					</>
				) : (
					<Button size="xs" variant="ghost" onClick={onEdit}>
						{t("common.rename")}
					</Button>
				)}
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button size="xs" variant="outline">
							{t("common.archive")}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent size="sm">
						<AlertDialogHeader>
							<AlertDialogTitle>{t("session.archiveTitle")}</AlertDialogTitle>
							<AlertDialogDescription>
								{t("session.archiveDescription")}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
							<AlertDialogAction onClick={() => onArchive(session.sessionId)}>
								{t("session.archiveConfirm")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
};
