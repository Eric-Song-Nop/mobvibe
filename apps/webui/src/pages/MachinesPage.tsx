import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MachineCard } from "@/components/machines/MachineCard";
import { RegisterMachineDialog } from "@/components/machines/RegisterMachineDialog";
import { Button } from "@/components/ui/button";
import { useMachinesStore } from "@/lib/machines-store";

export function MachinesPage() {
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

	return (
		<div className="flex h-full flex-col p-4">
			<div className="mb-4 flex items-center justify-between">
				<h1 className="text-lg font-semibold">{t("machines.title")}</h1>
				<Button onClick={() => setRegisterDialogOpen(true)}>
					{t("machines.register")}
				</Button>
			</div>

			<RegisterMachineDialog
				open={registerDialogOpen}
				onOpenChange={setRegisterDialogOpen}
			/>

			{machineList.length === 0 ? (
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center">
						<p className="text-muted-foreground mb-4">{t("machines.empty")}</p>
						<Button onClick={() => setRegisterDialogOpen(true)}>
							{t("machines.register")}
						</Button>
					</div>
				</div>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{machineList.map((machine) => (
						<MachineCard
							key={machine.machineId}
							machine={machine}
							isSelected={machine.machineId === selectedMachineId}
							onSelect={() => setSelectedMachineId(machine.machineId)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
