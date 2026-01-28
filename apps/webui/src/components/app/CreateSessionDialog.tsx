import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkingDirectoryDialog } from "@/components/app/WorkingDirectoryDialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type AcpBackendSummary, fetchFsRoots } from "@/lib/api";
import { useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";

export type CreateSessionDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	availableBackends: AcpBackendSummary[];
	isCreating: boolean;
	onCreate: () => void;
};

export function CreateSessionDialog({
	open,
	onOpenChange,
	availableBackends,
	isCreating,
	onCreate,
}: CreateSessionDialogProps) {
	const { t } = useTranslation();
	const [directoryDialogOpen, setDirectoryDialogOpen] = useState(false);
	const {
		draftTitle,
		draftBackendId,
		draftCwd,
		setDraftTitle,
		setDraftBackendId,
		setDraftCwd,
	} = useUiStore();
	const { selectedMachineId } = useMachinesStore();
	const rootsQuery = useQuery({
		queryKey: ["fs-roots", selectedMachineId],
		queryFn: () => fetchFsRoots({ machineId: selectedMachineId ?? undefined }),
		enabled: open && Boolean(selectedMachineId),
	});

	useEffect(() => {
		if (!open) {
			setDirectoryDialogOpen(false);
		}
	}, [open]);

	useEffect(() => {
		if (!open || draftCwd || !selectedMachineId) {
			return;
		}
		const homePath = rootsQuery.data?.homePath;
		if (homePath) {
			setDraftCwd(homePath);
		}
	}, [draftCwd, open, rootsQuery.data?.homePath, selectedMachineId, setDraftCwd]);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent
				size="default"
				className="w-[100vw] max-w-none sm:w-[92vw] sm:max-w-[92vw] lg:max-w-4xl"
			>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("session.createTitle")}</AlertDialogTitle>
					<AlertDialogDescription>
						{t("session.createDescription")}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="flex min-w-0 flex-col gap-3">
					<div className="flex flex-col gap-2">
						<Label htmlFor="session-title">{t("session.titleLabel")}</Label>
						<Input
							id="session-title"
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
							placeholder={t("session.titlePlaceholder")}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="session-backend">{t("session.backendLabel")}</Label>
						<Select
							value={draftBackendId}
							onValueChange={setDraftBackendId}
							disabled={availableBackends.length === 0}
						>
							<SelectTrigger id="session-backend">
								<SelectValue
									placeholder={
										availableBackends.length === 0
											? t("session.backendEmpty")
											: t("session.backendPlaceholder")
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{availableBackends.map((backend) => (
									<SelectItem key={backend.backendId} value={backend.backendId}>
										{backend.backendLabel || backend.backendId}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="session-cwd">{t("session.cwdLabel")}</Label>
						<InputGroup>
							<InputGroupInput
								id="session-cwd"
								value={draftCwd ?? ""}
								onChange={(event) => setDraftCwd(event.target.value)}
								placeholder={t("session.cwdPlaceholder")}
							/>
						<InputGroupAddon align="inline-end">
							<InputGroupButton
								type="button"
								onClick={() => setDirectoryDialogOpen(true)}
								disabled={!selectedMachineId}
							>
								{t("session.browse")}
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
					{!selectedMachineId ? (
						<div className="text-destructive text-xs">
							{t("errors.selectMachine")}
						</div>
					) : null}
				</div>
				<WorkingDirectoryDialog
					open={directoryDialogOpen}
					onOpenChange={setDirectoryDialogOpen}
					value={draftCwd}
					onChange={setDraftCwd}
					machineId={selectedMachineId ?? undefined}
				/>
			</div>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
				<AlertDialogAction
					disabled={
						isCreating ||
						!draftBackendId ||
						!draftCwd ||
						!selectedMachineId
					}
					onClick={(event) => {
						event.preventDefault();
						onCreate();
					}}
				>
						{isCreating ? t("common.creating") : t("common.create")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
