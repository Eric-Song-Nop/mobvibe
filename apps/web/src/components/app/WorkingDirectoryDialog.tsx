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
};

export function WorkingDirectoryDialog({
	open,
	onOpenChange,
	value,
	onChange,
}: WorkingDirectoryDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent size="default" className="max-w-[90vw] sm:max-w-4xl">
				<AlertDialogHeader>
					<AlertDialogTitle>选择工作目录</AlertDialogTitle>
					<AlertDialogDescription>
						点击目录或列标题可更新路径。
					</AlertDialogDescription>
				</AlertDialogHeader>
				<WorkingDirectoryPicker
					open={open}
					value={value}
					onChange={onChange}
					browserClassName="h-[20rem] sm:h-[28rem]"
					inputId="session-cwd-dialog"
				/>
				<AlertDialogFooter>
					<AlertDialogCancel>关闭</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
