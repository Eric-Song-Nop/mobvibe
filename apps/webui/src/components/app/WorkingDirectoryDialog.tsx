import { useTranslation } from "react-i18next";
import { WorkingDirectoryPicker } from "@/components/app/WorkingDirectoryPicker";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type WorkingDirectoryDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	value: string | undefined;
	onChange: (nextPath: string) => void;
	machineId?: string;
};

export function WorkingDirectoryDialog({
	open,
	onOpenChange,
	value,
	onChange,
	machineId,
}: WorkingDirectoryDialogProps) {
	const { t } = useTranslation();

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="flex h-[100svh] w-[100vw] max-w-none min-h-0 min-w-0 flex-col gap-4 overflow-hidden translate-x-0 translate-y-0 rounded-none p-4 sm:h-[80vh] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-none top-0 left-0 sm:top-1/2 sm:left-1/2">
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("workingDirectory.dialogTitle")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t("workingDirectory.dialogDescription")}
					</AlertDialogDescription>
				</AlertDialogHeader>

				<WorkingDirectoryPicker
					open={open}
					value={value}
					onChange={onChange}
					machineId={machineId}
					browserClassName="flex-1 min-h-0 h-auto sm:h-auto"
					inputId="session-cwd-dialog"
					className="flex-1 min-h-0"
				/>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
