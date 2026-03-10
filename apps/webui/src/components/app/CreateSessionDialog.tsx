import { ComputerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	generateDefaultWorktreeBranchName,
	sanitizeWorktreeBranchForPath,
} from "@mobvibe/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkingDirectoryDialog } from "@/components/app/WorkingDirectoryDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
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

const getBranchOptionLabel = (branch: {
	name: string;
	displayName?: string;
	current: boolean;
}) => branch.displayName ?? `${branch.name}${branch.current ? " (HEAD)" : ""}`;

export function CreateSessionDialog({
	open,
	onOpenChange,
	availableBackends,
	isCreating,
	onCreate,
}: CreateSessionDialogProps) {
	const { t } = useTranslation();
	const [directoryDialogOpen, setDirectoryDialogOpen] = useState(false);
	const [hasUserEditedWorktreeBranch, setHasUserEditedWorktreeBranch] =
		useState(false);
	const {
		draftTitle,
		draftBackendId,
		draftCwd,
		draftWorktreeEnabled,
		draftWorktreeBranch,
		draftWorktreeSuggestedBranch,
		draftWorktreeBaseBranch,
		setDraftTitle,
		setDraftBackendId,
		setDraftCwd,
		setDraftWorktreeEnabled,
		setDraftWorktreeBranch,
		setDraftWorktreeSuggestedBranch,
		setDraftWorktreeBaseBranch,
	} = useUiStore();
	const { selectedMachineId, machines } = useMachinesStore();
	const machineDisplayName = selectedMachineId
		? (machines[selectedMachineId]?.hostname ?? selectedMachineId.slice(0, 8))
		: undefined;

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
	const repoRoot = branchesQuery.data?.repoRoot;
	const repoName =
		branchesQuery.data?.repoName ?? getPathBasename(repoRoot ?? draftCwd);
	const relativeCwd = branchesQuery.data?.relativeCwd;
	const isGitContextStale = draftCwd !== debouncedCwd;
	const isResolvingGitContext =
		Boolean(draftCwd) &&
		Boolean(selectedMachineId) &&
		(isGitContextStale || branchesQuery.isFetching);
	const hasResolvedGitContext =
		Boolean(draftCwd) &&
		Boolean(selectedMachineId) &&
		!isGitContextStale &&
		branchesQuery.isFetched;
	const isWorktreeCreateDisabled =
		draftWorktreeEnabled &&
		(isGitContextStale || branchesQuery.isFetching || branchesQuery.isError);
	const effectiveWorktreeBranch =
		draftWorktreeBranch.trim() || draftWorktreeSuggestedBranch?.trim() || "";

	// Worktree path preview using CLI-configured base dir
	const worktreePathPreview = useMemo(() => {
		if (!repoName || !effectiveWorktreeBranch) return "";
		const sanitized = sanitizeWorktreeBranchForPath(effectiveWorktreeBranch);
		const base = worktreeBaseDir ?? "~/.mobvibe/worktrees";
		return `${base}/${repoName}/${sanitized}`;
	}, [effectiveWorktreeBranch, repoName, worktreeBaseDir]);

	const worktreeExecutionPathPreview = useMemo(() => {
		if (!worktreePathPreview) return "";
		if (!relativeCwd) return worktreePathPreview;
		return `${worktreePathPreview}/${relativeCwd}`;
	}, [relativeCwd, worktreePathPreview]);

	useEffect(() => {
		if (!open) {
			setDirectoryDialogOpen(false);
			setHasUserEditedWorktreeBranch(false);
		}
	}, [open]);

	useEffect(() => {
		if (!draftWorktreeEnabled) {
			setHasUserEditedWorktreeBranch(false);
		}
	}, [draftWorktreeEnabled]);

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
		if (
			!isGitContextStale &&
			branchesQuery.isFetched &&
			!isGitRepo &&
			draftWorktreeEnabled
		) {
			setDraftWorktreeEnabled(false);
		}
	}, [
		isGitContextStale,
		branchesQuery.isFetched,
		isGitRepo,
		draftWorktreeEnabled,
		setDraftWorktreeEnabled,
	]);

	useEffect(() => {
		if (
			!open ||
			!draftWorktreeEnabled ||
			!hasResolvedGitContext ||
			!isGitRepo
		) {
			return;
		}
		if (!draftWorktreeSuggestedBranch) {
			setDraftWorktreeSuggestedBranch(generateDefaultWorktreeBranchName());
			return;
		}
		if (!draftWorktreeBranch.trim() && !hasUserEditedWorktreeBranch) {
			setDraftWorktreeBranch(draftWorktreeSuggestedBranch);
		}
	}, [
		draftWorktreeBranch,
		draftWorktreeEnabled,
		draftWorktreeSuggestedBranch,
		hasResolvedGitContext,
		hasUserEditedWorktreeBranch,
		isGitRepo,
		open,
		setDraftWorktreeBranch,
		setDraftWorktreeSuggestedBranch,
	]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="default"
				className="w-[100vw] max-w-none sm:w-[92vw] sm:max-w-[92vw] lg:max-w-4xl"
			>
				<div className="grid gap-1.5 text-center sm:text-left">
					<DialogTitle>{t("session.createTitle")}</DialogTitle>
					<DialogDescription>
						{t("session.createDescription")}
					</DialogDescription>
				</div>
				{machineDisplayName ? (
					<div className="text-muted-foreground flex items-center gap-1.5 text-sm">
						<HugeiconsIcon
							icon={ComputerIcon}
							strokeWidth={2}
							className="size-4"
						/>
						<span>
							{t("session.targetMachine", { name: machineDisplayName })}
						</span>
					</div>
				) : null}
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

					{/* Loading state while resolving the current cwd */}
					{isResolvingGitContext ? (
						<div className="text-muted-foreground flex items-center gap-2 px-1 text-xs">
							<Skeleton className="h-4 w-4" />
							<Skeleton className="h-4 w-32" />
							<span>{t("session.projectDetection.checking")}</span>
						</div>
					) : null}

					{/* Error state */}
					{branchesQuery.isError ? (
						<div className="text-destructive text-xs">
							{t("session.worktree.queryError")}
						</div>
					) : null}

					{hasResolvedGitContext && draftCwd ? (
						<div className="border-border bg-muted/20 flex flex-col gap-1 rounded-md border px-3 py-2 text-xs">
							<div className="font-medium">
								{isGitRepo
									? t("session.projectDetection.gitRepo", {
											name: repoName ?? draftCwd,
										})
									: t("session.projectDetection.folder")}
							</div>
							{isGitRepo && repoRoot ? (
								<div className="text-muted-foreground">
									{t("session.projectDetection.repoRoot")}:{" "}
									<code className="bg-muted rounded px-1">{repoRoot}</code>
								</div>
							) : null}
							{isGitRepo && relativeCwd ? (
								<div className="text-muted-foreground">
									{t("session.projectDetection.relativeCwd")}:{" "}
									<code className="bg-muted rounded px-1">{relativeCwd}</code>
								</div>
							) : null}
							{!isGitRepo ? (
								<div className="text-muted-foreground">
									{t("session.projectDetection.nonGitHint")}
								</div>
							) : null}
						</div>
					) : null}

					{/* Worktree option — only shown after the current cwd resolves to a git repo */}
					{hasResolvedGitContext && isGitRepo ? (
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
											onChange={(event) => {
												setHasUserEditedWorktreeBranch(true);
												setDraftWorktreeBranch(event.target.value);
											}}
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
														{getBranchOptionLabel(b)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									{worktreePathPreview ? (
										<div className="flex flex-col gap-1 text-xs">
											<div className="text-muted-foreground">
												{t("session.worktree.pathLabel")}:{" "}
												<code className="bg-muted rounded px-1">
													{worktreePathPreview}
												</code>
											</div>
											{worktreeExecutionPathPreview !== worktreePathPreview ? (
												<div className="text-muted-foreground">
													{t("session.worktree.executionPathLabel")}:{" "}
													<code className="bg-muted rounded px-1">
														{worktreeExecutionPathPreview}
													</code>
												</div>
											) : null}
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
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						disabled={
							isCreating ||
							!draftBackendId ||
							!draftCwd ||
							!selectedMachineId ||
							isWorktreeCreateDisabled
						}
						onClick={onCreate}
					>
						{isCreating ? t("common.creating") : t("common.create")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
