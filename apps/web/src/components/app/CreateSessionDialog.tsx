import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

export type CreateSessionDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	draftTitle: string;
	onDraftTitleChange: (value: string) => void;
	draftBackendId: string | undefined;
	onDraftBackendChange: (value: string) => void;
	draftCwd: string | undefined;
	onDraftCwdChange: (value: string) => void;
	availableBackends: AcpBackendSummary[];
	isCreating: boolean;
	onCreate: () => void;
};

export function CreateSessionDialog({
	open,
	onOpenChange,
	draftTitle,
	onDraftTitleChange,
	draftBackendId,
	onDraftBackendChange,
	draftCwd,
	onDraftCwdChange,
	availableBackends,
	isCreating,
	onCreate,
}: CreateSessionDialogProps) {
	const [directoryDialogOpen, setDirectoryDialogOpen] = useState(false);
	const rootsQuery = useQuery({
		queryKey: ["fs-roots"],
		queryFn: fetchFsRoots,
		enabled: open,
	});

	useEffect(() => {
		if (!open) {
			setDirectoryDialogOpen(false);
		}
	}, [open]);

	useEffect(() => {
		if (!open || draftCwd) {
			return;
		}
		const homePath = rootsQuery.data?.homePath;
		if (homePath) {
			onDraftCwdChange(homePath);
		}
	}, [draftCwd, onDraftCwdChange, open, rootsQuery.data?.homePath]);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent size="default" className="sm:max-w-2xl">
				<AlertDialogHeader>
					<AlertDialogTitle>新建对话</AlertDialogTitle>
					<AlertDialogDescription>
						选择后端并设置对话标题与工作目录。
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="flex min-w-0 flex-col gap-3">
					<div className="flex flex-col gap-2">
						<Label htmlFor="session-title">标题</Label>
						<Input
							id="session-title"
							value={draftTitle}
							onChange={(event) => onDraftTitleChange(event.target.value)}
							placeholder="可选标题"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="session-backend">后端</Label>
						<Select
							value={draftBackendId}
							onValueChange={onDraftBackendChange}
							disabled={availableBackends.length === 0}
						>
							<SelectTrigger id="session-backend">
								<SelectValue
									placeholder={
										availableBackends.length === 0 ? "暂无可用后端" : "选择后端"
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
						<Label htmlFor="session-cwd">工作目录</Label>
						<InputGroup>
							<InputGroupInput
								id="session-cwd"
								value={draftCwd ?? ""}
								onChange={(event) => onDraftCwdChange(event.target.value)}
								placeholder="输入或粘贴 Home 内路径"
							/>
							<InputGroupAddon align="inline-end">
								<InputGroupButton
									type="button"
									onClick={() => setDirectoryDialogOpen(true)}
								>
									浏览
								</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
					</div>
					<WorkingDirectoryDialog
						open={directoryDialogOpen}
						onOpenChange={setDirectoryDialogOpen}
						value={draftCwd}
						onChange={onDraftCwdChange}
					/>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>取消</AlertDialogCancel>
					<AlertDialogAction
						disabled={isCreating || !draftBackendId || !draftCwd}
						onClick={(event) => {
							event.preventDefault();
							onCreate();
						}}
					>
						{isCreating ? "创建中..." : "创建"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
