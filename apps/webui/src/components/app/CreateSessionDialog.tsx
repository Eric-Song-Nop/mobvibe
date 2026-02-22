import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
	type AcpBackendSummary,
	fetchFsRoots,
	fetchGitBranchesForCwd,
} from "@/lib/api";
import { useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";
import { getPathBasename } from "@/lib/ui-utils";

export type CreateSessionDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	availableBackends: AcpBackendSummary[];
	isCreating: boolean;
	onCreate: () => void;
};

/** Sanitize branch name for worktree path preview */
const sanitizeBranch = (branch: string) => branch.replace(/[/\\]/g, "-");

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
		draftWorktreeEnabled,
		draftWorktreeBranch,
		draftWorktreeBaseBranch,
		setDraftTitle,
		setDraftBackendId,
		setDraftCwd,
		setDraftWorktreeEnabled,
		setDraftWorktreeBranch,
		setDraftWorktreeBaseBranch,
	} = useUiStore();
	const { selectedMachineId } = useMachinesStore();
	const rootsQuery = useQuery({
		queryKey: ["fs-roots", selectedMachineId],
		queryFn: () => fetchFsRoots({ machineId: selectedMachineId ?? undefined }),
		enabled: open && Boolean(selectedMachineId),
	});

	// Debounce cwd input to avoid excessive RPC requests
	const debouncedCwd = useDebouncedValue(draftCwd, 500);

	// Query git branches for the selected cwd (no session needed)
	const branchesQuery = useQuery({
		queryKey: ["git-branches-for-cwd", selectedMachineId, debouncedCwd],
		queryFn: () =>
			fetchGitBranchesForCwd({
				machineId: selectedMachineId!,
				cwd: debouncedCwd!,
			}),
		enabled:
			open &&
			Boolean(selectedMachineId) &&
			Boolean(debouncedCwd) &&
			debouncedCwd!.trim().length > 0,
	});

	const isGitRepo = branchesQuery.data?.isGitRepo ?? false;
	const branches = branchesQuery.data?.branches ?? [];
	const worktreeBaseDir = branchesQuery.data?.worktreeBaseDir;

	// Worktree path preview using CLI-configured base dir
	const worktreePathPreview = useMemo(() => {
		if (!draftCwd || !draftWorktreeBranch) return "";
		const repoName = getPathBasename(draftCwd) ?? draftCwd;
		const sanitized = sanitizeBranch(draftWorktreeBranch);
		const base = worktreeBaseDir ?? "~/.mobvibe/worktrees";
		return `${base}/${repoName}/${sanitized}`;
	}, [draftCwd, draftWorktreeBranch, worktreeBaseDir]);

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
	}, [
		draftCwd,
		open,
		rootsQuery.data?.homePath,
		selectedMachineId,
		setDraftCwd,
	]);

	// Reset worktree when query completes and cwd is not a git repo
	useEffect(() => {
		if (branchesQuery.isFetched && !isGitRepo && draftWorktreeEnabled) {
			setDraftWorktreeEnabled(false);
		}
	}, [
		branchesQuery.isFetched,
		isGitRepo,
		draftWorktreeEnabled,
		setDraftWorktreeEnabled,
	]);

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
							name="session-title"
							autoComplete="off"
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
								name="session-cwd"
								autoComplete="off"
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

					{/* Loading skeleton while checking git repo */}
					{branchesQuery.isFetching && !branchesQuery.data ? (
						<div className="flex items-center gap-2 px-1">
							<Skeleton className="h-4 w-4" />
							<Skeleton className="h-4 w-32" />
						</div>
					) : null}

					{/* Error state */}
					{branchesQuery.isError ? (
						<div className="text-destructive text-xs">
							{t("session.worktree.queryError")}
						</div>
					) : null}

					{/* Worktree option — only shown after query completes and cwd is a git repo */}
					{branchesQuery.isFetched && isGitRepo ? (
						<div className="flex flex-col gap-2">
							<label
								htmlFor="worktree-enable"
								className="flex items-center gap-2 cursor-pointer select-none"
							>
								<Checkbox
									id="worktree-enable"
									checked={draftWorktreeEnabled}
									onCheckedChange={(checked) =>
										setDraftWorktreeEnabled(checked === true)
									}
								/>
								<span className="text-sm font-medium">
									{t("session.worktree.enable")}
								</span>
							</label>

							{draftWorktreeEnabled ? (
								<div className="border-border bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
									<div className="flex flex-col gap-1">
										<Label htmlFor="worktree-branch">
											{t("session.worktree.branchLabel")}
										</Label>
										<Input
											id="worktree-branch"
											name="worktree-branch"
											autoComplete="off"
											value={draftWorktreeBranch}
											onChange={(e) => setDraftWorktreeBranch(e.target.value)}
											placeholder={t("session.worktree.branchPlaceholder")}
										/>
									</div>
									<div className="flex flex-col gap-1">
										<Label htmlFor="worktree-base-branch">
											{t("session.worktree.baseBranchLabel")}
										</Label>
										<Select
											value={draftWorktreeBaseBranch ?? ""}
											onValueChange={(v) =>
												setDraftWorktreeBaseBranch(v || undefined)
											}
										>
											<SelectTrigger id="worktree-base-branch">
												<SelectValue
													placeholder={t(
														"session.worktree.baseBranchPlaceholder",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{branches.map((b) => (
													<SelectItem key={b.name} value={b.name}>
														{b.name}
														{b.current ? " (HEAD)" : ""}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									{worktreePathPreview ? (
										<div className="text-muted-foreground text-xs">
											{t("session.worktree.pathLabel")}:{" "}
											<code className="bg-muted rounded px-1">
												{worktreePathPreview}
											</code>
										</div>
									) : null}
								</div>
							) : null}
						</div>
					) : null}

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
							!selectedMachineId ||
							(draftWorktreeEnabled && !draftWorktreeBranch.trim())
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
