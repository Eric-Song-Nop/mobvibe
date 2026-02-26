import { useTranslation } from "react-i18next";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Machine } from "@/lib/machines-store";
import { cn } from "@/lib/utils";

type MachineCardProps = {
	machine: Machine;
	isSelected: boolean;
	onSelect: () => void;
	onRemove?: () => void;
};

export function MachineCard({
	machine,
	isSelected,
	onSelect,
	onRemove,
}: MachineCardProps) {
	const { t } = useTranslation();
	const displayName = machine.hostname ?? machine.machineId.slice(0, 12);

	return (
		<Card
			className={cn(
				"cursor-pointer transition-colors",
				isSelected && "border-primary",
				!machine.connected && "opacity-60",
			)}
			role="button"
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
		>
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between gap-2">
					<CardTitle className="text-sm font-medium">{displayName}</CardTitle>
					<Badge variant={machine.connected ? "default" : "secondary"}>
						{machine.connected ? t("machines.online") : t("machines.offline")}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-2">
				<div className="text-xs text-muted-foreground">
					<div>ID: {machine.machineId.slice(0, 12)}…</div>
					{machine.sessionCount !== undefined && (
						<div>{t("machines.sessions", { count: machine.sessionCount })}</div>
					)}
				</div>

				{onRemove && (
					<div className="flex justify-end pt-2">
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									variant="destructive"
									size="xs"
									onClick={(e) => e.stopPropagation()}
								>
									{t("machines.remove")}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent size="sm">
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("machines.removeTitle")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t("machines.removeDescription")}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
									<AlertDialogAction variant="destructive" onClick={onRemove}>
										{t("machines.remove")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
