import { AddCircleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ChatSession } from "@mobvibe/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RegisterMachineDialog } from "@/components/machines/RegisterMachineDialog";
import { SessionSidebar } from "@/components/session/SessionSidebar";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMachinesQuery } from "@/hooks/useMachinesQuery";
import { discoverSessions } from "@/lib/api";
import { type Machine, useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

export type AppSidebarProps = {
	sessions: ChatSession[];
	activeSessionId: string | undefined;
	onCreateSession: () => void;
	onSelectSession: (sessionId: string) => void;
	onEditSubmit: () => void;
	onCloseSession: (sessionId: string) => void;
	isCreating: boolean;
	/** Whether a session is being activated (restored/loaded) */
	isActivating?: boolean;
};

export function AppSidebar({
	sessions,
	activeSessionId,
	onCreateSession,
	onSelectSession,
	onEditSubmit,
	onCloseSession,
	isCreating,
	isActivating: _isActivating,
}: AppSidebarProps) {
	const { mobileMenuOpen, setMobileMenuOpen } = useUiStore();
	return (
		<>
			<aside className="bg-background/80 border-r hidden w-64 flex-col px-4 py-4 md:flex min-h-0 overflow-hidden">
				<SessionSidebar
					sessions={sessions}
					activeSessionId={activeSessionId}
					onCreateSession={onCreateSession}
					onSelectSession={onSelectSession}
					onEditSubmit={onEditSubmit}
					onCloseSession={onCloseSession}
					isCreating={isCreating}
				/>
			</aside>
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
								onCloseSession={onCloseSession}
								isCreating={isCreating}
							/>
						</div>
					</div>
					<button
						type="button"
						className="bg-black/30 flex-1"
						onClick={() => setMobileMenuOpen(false)}
					/>
				</div>
			) : null}
		</>
	);
}

function MobileMachineColumn() {
	const { t } = useTranslation();
	const { machines, selectedMachineId, setSelectedMachineId } =
		useMachinesStore();
	const machinesQuery = useMachinesQuery();
	const queryClient = useQueryClient();
	const [registerDialogOpen, setRegisterDialogOpen] = useState(false);

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
			connectedMachineIds.map((machineId) => discoverSessions({ machineId })),
		);
		await queryClient.refetchQueries({ queryKey: ["sessions"] });
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
							onClick={() => setRegisterDialogOpen(true)}
							className="mt-auto"
						>
							<HugeiconsIcon icon={AddCircleIcon} strokeWidth={2} />
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
	onSelect: () => void;
};

function MachineIcon({ machine, isSelected, onSelect }: MachineIconProps) {
	const { t } = useTranslation();
	const displayName = machine.hostname ?? machine.machineId.slice(0, 8);
	const initials = displayName.slice(0, 2).toUpperCase();

	return (
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
	);
}
