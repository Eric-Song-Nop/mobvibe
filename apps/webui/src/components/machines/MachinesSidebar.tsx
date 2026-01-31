import { AddCircleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MachineWorkspaces } from "@/components/machines/MachineWorkspaces";
import { RegisterMachineDialog } from "@/components/machines/RegisterMachineDialog";
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
import { type Machine, useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

const queryKeys = {
	machines: ["machines"],
	sessions: ["sessions"],
};

type MachinesSidebarProps = {
	onAddMachine?: () => void;
};

export function MachinesSidebar({ onAddMachine }: MachinesSidebarProps) {
	const { t } = useTranslation();
	const {
		machines,
		selectedMachineId,
		setSelectedMachineId,
		setMachineCapabilities,
	} = useMachinesStore();
	const {
		selectedWorkspaceByMachine,
		expandedMachines,
		toggleMachineExpanded,
		machineSidebarWidth,
		setMachineSidebarWidth,
	} = useUiStore();
	const machinesQuery = useMachinesQuery();
	const queryClient = useQueryClient();
	const discoverSessionsMutation = useDiscoverSessionsMutation();
	const [registerDialogOpen, setRegisterDialogOpen] = useState(false);

	const machineList = Object.values(machines).sort((a, b) => {
		// Connected machines first, then by hostname
		if (a.connected !== b.connected) {
			return a.connected ? -1 : 1;
		}
		return (a.hostname ?? a.machineId).localeCompare(b.hostname ?? b.machineId);
	});

	const handleAddMachine = () => {
		if (onAddMachine) {
			onAddMachine();
		} else {
			setRegisterDialogOpen(true);
		}
	};

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
		await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
	};

	return (
		<TooltipProvider delayDuration={300}>
			<RegisterMachineDialog
				open={registerDialogOpen}
				onOpenChange={setRegisterDialogOpen}
			/>

			<aside
				className="bg-background/80 border-r hidden flex-col items-center gap-2 py-3 md:flex"
				style={{ width: machineSidebarWidth }}
			>
				<div className="flex flex-col items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
					<span>{t("machines.title")}</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-sm" onClick={handleRefresh}>
								<HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
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
							onClick={handleAddMachine}
							className="mt-auto"
						>
							<HugeiconsIcon icon={AddCircleIcon} strokeWidth={2} />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">{t("machines.register")}</TooltipContent>
				</Tooltip>
			</aside>
			<ResizeHandle
				className="hidden md:block"
				onResize={(deltaX) =>
					setMachineSidebarWidth(machineSidebarWidth + deltaX)
				}
			/>
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
		<TooltipProvider delayDuration={300}>
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

						{/* Connection status indicator */}
						<span
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
		</TooltipProvider>
	);
}
