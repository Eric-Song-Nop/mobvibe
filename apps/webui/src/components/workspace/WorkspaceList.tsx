import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDiscoverSessionsMutation } from "@/hooks/useSessionQueries";
import { fetchFsEntries } from "@/lib/api";
import { useChatStore } from "@/lib/chat-store";
import { useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { collectWorkspaces } from "@/lib/workspace-utils";

type WorkspaceListProps = {
	machineId: string;
	onEmptyCreateSession: () => void;
};

export function WorkspaceList({
	machineId,
	onEmptyCreateSession,
}: WorkspaceListProps) {
	const { t } = useTranslation();
	const { sessions } = useChatStore();
	const { machines, setSelectedMachineId, updateBackendCapabilities } =
		useMachinesStore();
	const { selectedWorkspaceByMachine, setSelectedWorkspace, setSidebarTab } =
		useUiStore();
	const discoverSessionsMutation = useDiscoverSessionsMutation();

	const workspaceList = useMemo(
		() => collectWorkspaces(sessions, machineId),
		[sessions, machineId],
	);

	const machine = machines[machineId];
	const canValidate = Boolean(machine?.connected);

	const workspaceValidityQueries = useQueries({
		queries: canValidate
			? workspaceList.map((workspace) => ({
					queryKey: ["fs-entries", machineId, workspace.cwd],
					queryFn: () => fetchFsEntries({ path: workspace.cwd, machineId }),
					retry: false,
					staleTime: 60_000,
				}))
			: [],
	});

	const validWorkspaces = useMemo(() => {
		if (!canValidate) return [];
		return workspaceList.filter(
			(_, index) => workspaceValidityQueries[index]?.isSuccess,
		);
	}, [canValidate, workspaceList, workspaceValidityQueries]);

	const isValidating =
		canValidate && workspaceValidityQueries.some((query) => query.isFetching);

	const selectedWorkspaceCwd = selectedWorkspaceByMachine[machineId];

	// Fallback when selected workspace becomes invalid
	const selectedWorkspaceQueryState = useMemo(() => {
		if (!canValidate || !selectedWorkspaceCwd) return undefined;
		const index = workspaceList.findIndex(
			(w) => w.cwd === selectedWorkspaceCwd,
		);
		if (index === -1) return "not-found" as const;
		const q = workspaceValidityQueries[index];
		if (!q || q.isFetching) return "pending" as const;
		if (q.isError) return "error" as const;
		return "success" as const;
	}, [
		canValidate,
		selectedWorkspaceCwd,
		workspaceList,
		workspaceValidityQueries,
	]);

	useEffect(() => {
		if (!canValidate || !selectedWorkspaceCwd) return;
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
		canValidate,
		machineId,
		selectedWorkspaceCwd,
		selectedWorkspaceQueryState,
		setSelectedWorkspace,
		validWorkspaces,
	]);

	const handleSelectWorkspace = (cwd: string) => {
		setSelectedMachineId(machineId);
		setSelectedWorkspace(machineId, cwd);
		setSidebarTab("sessions");
		discoverSessionsMutation.mutate(
			{ machineId, cwd },
			{
				onSuccess: (result) => {
					updateBackendCapabilities(machineId, result.backendCapabilities);
				},
			},
		);
	};

	const handleEmptyClick = () => {
		setSelectedMachineId(machineId);
		onEmptyCreateSession();
	};

	if (isValidating && validWorkspaces.length === 0) {
		return (
			<div className="text-muted-foreground text-xs p-2">
				{t("common.loading")}
			</div>
		);
	}

	if (validWorkspaces.length === 0) {
		return (
			<button
				type="button"
				onClick={handleEmptyClick}
				className="text-xs text-muted-foreground hover:text-foreground p-2"
			>
				{t("workspace.empty")}
			</button>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			{validWorkspaces.map((workspace) => {
				const isActive = workspace.cwd === selectedWorkspaceCwd;
				return (
					<button
						key={`${workspace.machineId}:${workspace.cwd}`}
						type="button"
						onClick={() => handleSelectWorkspace(workspace.cwd)}
						className={cn(
							"flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
							isActive
								? "bg-accent border-l-primary border-l-2 font-semibold"
								: "hover:bg-muted/50",
						)}
					>
						<span className="truncate text-sm">{workspace.label}</span>
						<span className="text-muted-foreground truncate text-xs">
							{workspace.cwd}
						</span>
					</button>
				);
			})}
		</div>
	);
}
