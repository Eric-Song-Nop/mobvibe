import { AddCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RegisterMachineDialog } from "@/components/machines/RegisterMachineDialog";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { type Machine, useMachinesStore } from "@/lib/machines-store";
import { cn } from "@/lib/utils";

type MachinesSidebarProps = {
	onAddMachine?: () => void;
};

export function MachinesSidebar({ onAddMachine }: MachinesSidebarProps) {
	const { t } = useTranslation();
	const { machines, selectedMachineId, setSelectedMachineId } =
		useMachinesStore();
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

	return (
		<TooltipProvider delayDuration={300}>
			<RegisterMachineDialog
				open={registerDialogOpen}
				onOpenChange={setRegisterDialogOpen}
			/>

			<aside className="bg-background/80 border-r hidden w-14 flex-col items-center gap-2 py-3 md:flex">
				<div className="text-xs font-semibold text-muted-foreground mb-1">
					{t("machines.title")}
				</div>

				<div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
					{machineList.length === 0 ? (
						<div className="text-muted-foreground text-[10px] text-center px-1">
							{t("machines.empty")}
						</div>
					) : null}

					{machineList.map((machine) => (
						<MachineIcon
							key={machine.machineId}
							machine={machine}
							isSelected={machine.machineId === selectedMachineId}
							onSelect={() => setSelectedMachineId(machine.machineId)}
						/>
					))}
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
		</TooltipProvider>
	);
}

type MachineIconProps = {
	machine: Machine;
	isSelected: boolean;
	onSelect: () => void;
};

function MachineIcon({ machine, isSelected, onSelect }: MachineIconProps) {
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
						className={cn(
							"relative flex h-10 w-10 items-center justify-center rounded-sm border transition-colors",
							isSelected
								? "border-primary bg-primary/10 text-primary"
								: "border-border bg-background hover:bg-muted text-foreground",
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
