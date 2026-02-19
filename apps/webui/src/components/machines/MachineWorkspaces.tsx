import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDiscoverSessionsMutation } from "@/hooks/useSessionQueries";
import { fetchFsEntries } from "@/lib/api";
import { type ChatSession, useChatStore } from "@/lib/chat-store";
import { useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { collectWorkspaces } from "@/lib/workspace-utils";

const getWorkspaceInitials = (label: string) => {
	const trimmed = label.trim();
	if (trimmed.length === 0) {
		return "--";
	}
	return trimmed.slice(0, 2).toUpperCase();
};

const sortSessionsByUpdatedAt = (sessions: ChatSession[]) =>
	[...sessions].sort((left, right) => {
		const leftStamp = left.updatedAt ?? left.createdAt ?? "";
		const rightStamp = right.updatedAt ?? right.createdAt ?? "";
		return rightStamp.localeCompare(leftStamp);
	});

type MachineWorkspacesProps = {
	machineId: string;
	isExpanded: boolean;
	className?: string;
};

export function MachineWorkspaces({
	machineId,
	isExpanded,
	className,
}: MachineWorkspacesProps) {
	const { t } = useTranslation();
	const { sessions, activeSessionId, setActiveSessionId } = useChatStore();
	const { machines, setSelectedMachineId, setMachineCapabilities } =
		useMachinesStore();
	const {
		selectedWorkspaceByMachine,
		setSelectedWorkspace,
		setCreateDialogOpen,
	} = useUiStore();
	const discoverSessionsMutation = useDiscoverSessionsMutation();

	const workspaceList = useMemo(
		() => collectWorkspaces(sessions, machineId),
		[sessions, machineId],
	);
	const machine = machines[machineId];
	const canValidateWorkspaces = Boolean(isExpanded && machine?.connected);
	const workspaceValidityQueries = useQueries({
		queries: canValidateWorkspaces
			? workspaceList.map((workspace) => ({
					queryKey: ["fs-entries", machineId, workspace.cwd],
					queryFn: () => fetchFsEntries({ path: workspace.cwd, machineId }),
					retry: false,
					staleTime: 60_000,
				}))
			: [],
	});
	const validWorkspaces = useMemo(() => {
		if (!canValidateWorkspaces) {
			return [];
		}
		return workspaceList.filter(
			(_, index) => workspaceValidityQueries[index]?.isSuccess,
		);
	}, [canValidateWorkspaces, workspaceList, workspaceValidityQueries]);
	const isValidating =
		canValidateWorkspaces &&
		workspaceValidityQueries.some((query) => query.isFetching);
	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
	const activeWorkspaceCwd =
		activeSession?.machineId === machineId ? activeSession.cwd : undefined;
	const selectedWorkspaceCwd = selectedWorkspaceByMachine[machineId];
	const effectiveWorkspaceCwd = activeWorkspaceCwd ?? selectedWorkspaceCwd;

	const selectedWorkspaceQueryState = useMemo(() => {
		if (!canValidateWorkspaces || !selectedWorkspaceCwd) return undefined;
		const index = workspaceList.findIndex(
			(w) => w.cwd === selectedWorkspaceCwd,
		);
		if (index === -1) return "not-found" as const;
		const q = workspaceValidityQueries[index];
		if (!q || q.isFetching) return "pending" as const;
		if (q.isError) return "error" as const;
		return "success" as const;
	}, [
		canValidateWorkspaces,
		selectedWorkspaceCwd,
		workspaceList,
		workspaceValidityQueries,
	]);

	useEffect(() => {
		if (!canValidateWorkspaces || !selectedWorkspaceCwd) return;
		if (
			selectedWorkspaceQueryState === "not-found" ||
			selectedWorkspaceQueryState === "error"
		) {
			const fallback = validWorkspaces.find(
				(ws) => ws.cwd !== selectedWorkspaceCwd,
			);
			if (fallback) {
				setSelectedWorkspace(machineId, fallback.cwd);
			}
		}
	}, [
		canValidateWorkspaces,
		machineId,
		selectedWorkspaceCwd,
		selectedWorkspaceQueryState,
		setSelectedWorkspace,
		validWorkspaces,
	]);

	if (!isExpanded) {
		return null;
	}

	const handleSelectWorkspace = (cwd: string) => {
		setSelectedMachineId(machineId);
		setSelectedWorkspace(machineId, cwd);
		discoverSessionsMutation.mutate(
			{ machineId, cwd },
			{
				onSuccess: (result) => {
					setMachineCapabilities(machineId, result.capabilities);
				},
			},
		);
		const nextSession = sortSessionsByUpdatedAt(
			Object.values(sessions).filter(
				(session) => session.machineId === machineId && session.cwd === cwd,
			),
		)[0];
		if (nextSession) {
			setActiveSessionId(nextSession.sessionId);
		}
	};

	const handleEmptyClick = () => {
		setSelectedMachineId(machineId);
		setCreateDialogOpen(true);
	};

	return (
		<div className={cn("flex flex-col items-center gap-1", className)}>
			{isValidating && validWorkspaces.length === 0 ? (
				<div className="text-muted-foreground text-[10px] text-center px-1">
					{t("common.loading")}
				</div>
			) : validWorkspaces.length === 0 ? (
				<button
					type="button"
					onClick={handleEmptyClick}
					className="text-[10px] text-muted-foreground hover:text-foreground"
				>
					{t("workspace.empty")}
				</button>
			) : (
				validWorkspaces.map((workspace) => {
					const isActive = workspace.cwd === effectiveWorkspaceCwd;
					const initials = getWorkspaceInitials(workspace.label);
					return (
						<button
							key={`${workspace.machineId}:${workspace.cwd}`}
							type="button"
							onClick={() => handleSelectWorkspace(workspace.cwd)}
							className={cn(
								"flex flex-col items-center gap-0.5 text-[9px]",
								isActive
									? "text-primary"
									: "text-muted-foreground hover:text-foreground",
							)}
							title={`${workspace.label} - ${workspace.cwd}`}
						>
							<span
								className={cn(
									"flex h-7 w-7 items-center justify-center rounded-sm border transition-colors",
									isActive
										? "border-primary bg-primary/10"
										: "border-border bg-background hover:bg-muted",
								)}
							>
								<span className="text-[10px] font-semibold">{initials}</span>
							</span>
							<span className="w-10 truncate">{workspace.label}</span>
						</button>
					);
				})
			)}
		</div>
	);
}
