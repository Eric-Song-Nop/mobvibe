import { AddCircleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MachineWorkspaces } from "@/components/machines/MachineWorkspaces";
import { RegisterMachineDialog } from "@/components/machines/RegisterMachineDialog";
import { SessionSidebar } from "@/components/session/SessionSidebar";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMachinesQuery } from "@/hooks/useMachinesQuery";
import { useDiscoverSessionsMutation } from "@/hooks/useSessionQueries";
import type { ChatSession } from "@/lib/chat-store";
import { type Machine, useMachinesStore } from "@/lib/machines-store";
import type { SessionMutationsSnapshot } from "@/lib/session-utils";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

export type AppSidebarProps = {
	sessions: ChatSession[];
	activeSessionId: string | undefined;
	onCreateSession: () => void;
	onSelectSession: (sessionId: string) => void;
	onEditSubmit: () => void;
	onArchiveSession: (sessionId: string) => void;
	onArchiveAllSessions: (sessionIds: string[]) => void;
	isBulkArchiving?: boolean;
	isCreating: boolean;
	mutations: SessionMutationsSnapshot;
};

export function AppSidebar({
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
}: AppSidebarProps) {
	const {
		mobileMenuOpen,
		setMobileMenuOpen,
		sessionSidebarWidth,
		setSessionSidebarWidth,
	} = useUiStore();
	return (
		<>
			<aside
				className="bg-background/80 border-r hidden flex-col px-4 py-4 md:flex min-h-0 overflow-hidden"
				style={{ width: sessionSidebarWidth }}
			>
				<SessionSidebar
					sessions={sessions}
					activeSessionId={activeSessionId}
					onCreateSession={onCreateSession}
					onSelectSession={onSelectSession}
					onEditSubmit={onEditSubmit}
					onArchiveSession={onArchiveSession}
					onArchiveAllSessions={onArchiveAllSessions}
					isBulkArchiving={isBulkArchiving}
					isCreating={isCreating}
					mutations={mutations}
				/>
			</aside>
			<ResizeHandle
				className="hidden md:block"
				onResize={(deltaX) =>
					setSessionSidebarWidth(sessionSidebarWidth + deltaX)
				}
			/>
			{mobileMenuOpen ? (
				<div className="fixed inset-0 z-50 flex md:hidden">
					<div className="bg-background/90 border-r w-80 p-0 flex h-full overflow-hidden">
						<MobileMachineColumn />
						<div className="flex-1 p-4 overflow-hidden flex flex-col min-w-0">
							<SessionSidebar
								sessions={sessions}
								activeSessionId={activeSessionId}
								onCreateSession={onCreateSession}
								onSelectSession={(sessionId) => {
									onSelectSession(sessionId);
									setMobileMenuOpen(false);
								}}
								onEditSubmit={onEditSubmit}
								onArchiveSession={onArchiveSession}
								onArchiveAllSessions={onArchiveAllSessions}
								isBulkArchiving={isBulkArchiving}
								isCreating={isCreating}
								mutations={mutations}
							/>
						</div>
					</div>
					<button
						type="button"
						className="bg-black/30 flex-1"
						aria-label="Close menu"
						onClick={() => setMobileMenuOpen(false)}
					/>
				</div>
			) : null}
		</>
	);
}

function MobileMachineColumn() {
	const { t } = useTranslation();
	const {
		machines,
		selectedMachineId,
		setSelectedMachineId,
		setMachineCapabilities,
	} = useMachinesStore();
	const machinesQuery = useMachinesQuery();
	const queryClient = useQueryClient();
	const discoverSessionsMutation = useDiscoverSessionsMutation();
	const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
	const {
		selectedWorkspaceByMachine,
		expandedMachines,
		toggleMachineExpanded,
	} = useUiStore();

	const machineList = Object.values(machines).sort((a, b) => {
		if (a.connected !== b.connected) {
			return a.connected ? -1 : 1;
		}
		return (a.hostname ?? a.machineId).localeCompare(b.hostname ?? b.machineId);
	});

	const handleRefresh = async () => {
		const result = await machinesQuery.refetch();
		const connectedMachineIds =
			result.data?.machines
				?.filter((machine) => machine.isOnline)
				.map((machine) => machine.id) ?? [];

		await Promise.allSettled(
			connectedMachineIds.map(async (machineId) => {
				const cwd = selectedWorkspaceByMachine[machineId];
				if (!cwd) {
					return;
				}
				const result = await discoverSessionsMutation.mutateAsync({
					machineId,
					cwd,
				});
				setMachineCapabilities(machineId, result.capabilities);
			}),
		);
		await queryClient.invalidateQueries({ queryKey: ["sessions"] });
	};

	return (
		<TooltipProvider delayDuration={300}>
			<RegisterMachineDialog
				open={registerDialogOpen}
				onOpenChange={setRegisterDialogOpen}
			/>
			<div className="w-14 flex-shrink-0 flex flex-col items-center gap-2 py-3 border-r bg-background/50">
				<div className="flex flex-col items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
					<span>{t("machines.title")}</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleRefresh}
								aria-label={t("machines.refresh")}
							>
								<HugeiconsIcon
									icon={Refresh01Icon}
									strokeWidth={2}
									aria-hidden="true"
								/>
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">
							{t("machines.refresh")}
						</TooltipContent>
					</Tooltip>
				</div>

				<div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
					{machineList.length === 0 ? (
						<div className="text-muted-foreground text-[10px] text-center px-1">
							{t("machines.empty")}
						</div>
					) : null}

					{machineList.map((machine) => {
						const isExpanded = Boolean(expandedMachines[machine.machineId]);
						return (
							<div
								key={machine.machineId}
								className="flex flex-col items-center gap-1"
							>
								<MachineIcon
									machine={machine}
									isSelected={machine.machineId === selectedMachineId}
									isExpanded={isExpanded}
									onSelect={() => {
										setSelectedMachineId(machine.machineId);
										toggleMachineExpanded(machine.machineId);
									}}
								/>
								<MachineWorkspaces
									machineId={machine.machineId}
									isExpanded={isExpanded}
								/>
							</div>
						);
					})}
				</div>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setRegisterDialogOpen(true)}
							className="mt-auto"
							aria-label={t("machines.register")}
						>
							<HugeiconsIcon
								icon={AddCircleIcon}
								strokeWidth={2}
								aria-hidden="true"
							/>
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">{t("machines.register")}</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	);
}

type MachineIconProps = {
	machine: Machine;
	isSelected: boolean;
	isExpanded?: boolean;
	onSelect: () => void;
};

function MachineIcon({
	machine,
	isSelected,
	isExpanded,
	onSelect,
}: MachineIconProps) {
	const { t } = useTranslation();
	const displayName = machine.hostname ?? machine.machineId.slice(0, 8);
	const initials = displayName.slice(0, 2).toUpperCase();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onSelect}
					aria-expanded={isExpanded}
					className={cn(
						"relative flex h-10 w-10 items-center justify-center rounded-sm border transition-colors",
						isSelected
							? "border-primary bg-primary/10 text-primary"
							: "border-border bg-background hover:bg-muted text-foreground",
						isExpanded && !isSelected && "border-primary/40",
						!machine.connected && "opacity-50",
					)}
				>
					<span className="text-xs font-medium">{initials}</span>
					<span
						aria-hidden="true"
						className={cn(
							"absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
							machine.connected ? "bg-green-500" : "bg-gray-400",
						)}
					/>
				</button>
			</TooltipTrigger>
			<TooltipContent side="right" className="max-w-[200px]">
				<div className="space-y-1">
					<div className="font-medium">{displayName}</div>
					<div className="text-xs text-muted-foreground">
						{machine.connected ? t("machines.online") : t("machines.offline")}
					</div>
					{machine.sessionCount !== undefined && (
						<div className="text-xs text-muted-foreground">
							{t("machines.sessions", { count: machine.sessionCount })}
						</div>
					)}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
