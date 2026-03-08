import { render, screen } from "@testing-library/react";
import type {
	ButtonHTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSessionDialog } from "../CreateSessionDialog";

const mockDebouncedValue = vi.hoisted(() => ({ cwd: "/repo/apps/webui" }));
const mockUiState = vi.hoisted(() => ({
	draftTitle: "Session 1",
	draftBackendId: "backend-1",
	draftCwd: "/repo/apps/webui",
	draftWorktreeEnabled: true,
	draftWorktreeBranch: "feat/live-cwd",
	draftWorktreeBaseBranch: "main",
	setDraftTitle: vi.fn(),
	setDraftBackendId: vi.fn(),
	setDraftCwd: vi.fn(),
	setDraftWorktreeEnabled: vi.fn(),
	setDraftWorktreeBranch: vi.fn(),
	setDraftWorktreeBaseBranch: vi.fn(),
}));

const mockMachinesState = vi.hoisted(() => ({
	selectedMachineId: "machine-1",
	machines: {
		"machine-1": {
			machineId: "machine-1",
			hostname: "dev-box",
			connected: true,
		},
	},
}));

const mockQueryState = vi.hoisted(() => ({
	roots: {
		data: { homePath: "/home/tester", roots: [] },
		isFetching: false,
		isFetched: true,
		isError: false,
	},
	branches: {
		data: undefined as
			| {
					isGitRepo: boolean;
					branches: Array<{
						name: string;
						displayName?: string;
						current?: boolean;
					}>;
					repoRoot?: string;
					repoName?: string;
					relativeCwd?: string;
					worktreeBaseDir?: string;
			  }
			| undefined,
		isFetching: false,
		isFetched: false,
		isError: false,
	},
}));

vi.mock("react-i18next", () => ({
	initReactI18next: { type: "3rdParty", init: () => {} },
	useTranslation: () => ({
		t: (key: string, options?: Record<string, string>) => {
			const translations: Record<string, string> = {
				"session.createTitle": "New conversation",
				"session.createDescription": "Choose a backend and set the title.",
				"session.targetMachine": `Target: ${options?.name ?? ""}`,
				"session.titleLabel": "Title",
				"session.titlePlaceholder": "Optional title",
				"session.backendLabel": "Backend",
				"session.backendPlaceholder": "Select backend",
				"session.cwdLabel": "Working directory",
				"session.cwdPlaceholder": "Enter a path",
				"session.browse": "Browse",
				"session.projectDetection.checking": "Checking project...",
				"session.projectDetection.repoRoot": "Project root",
				"session.projectDetection.relativeCwd": "Selected subdirectory",
				"session.projectDetection.folder": "Folder detected",
				"session.projectDetection.gitRepo": `Git repo detected: ${options?.name ?? ""}`,
				"session.projectDetection.nonGitHint": "Non-git folder",
				"session.worktree.enable": "Create in new worktree",
				"session.worktree.branchLabel": "New branch",
				"session.worktree.branchPlaceholder": "feat/example",
				"session.worktree.baseBranchLabel": "Based on",
				"session.worktree.baseBranchPlaceholder": "Select base branch",
				"session.worktree.pathLabel": "Worktree path",
				"session.worktree.executionPathLabel": "Execution directory",
				"session.worktree.queryError": "Failed to check git repository status",
				"common.cancel": "Cancel",
				"common.create": "Create",
				"common.creating": "Creating...",
			};
			return translations[key] ?? key;
		},
	}),
}));

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query",
	);
	return {
		...actual,
		useQuery: (options: { queryKey: unknown[] }) => {
			if (options.queryKey[0] === "fs-roots") {
				return mockQueryState.roots;
			}
			if (options.queryKey[0] === "git-branches-for-cwd") {
				return mockQueryState.branches;
			}
			throw new Error(`Unexpected query key: ${String(options.queryKey[0])}`);
		},
	};
});

vi.mock("@/hooks/useDebouncedValue", () => ({
	useDebouncedValue: () => mockDebouncedValue.cwd,
}));

vi.mock("@/components/app/WorkingDirectoryDialog", () => ({
	WorkingDirectoryDialog: () => null,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogCancel: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
	AlertDialogAction: ({
		children,
		disabled,
		onClick,
	}: {
		children: ReactNode;
		disabled?: boolean;
		onClick?: (event: { preventDefault: () => void }) => void;
	}) => (
		<button
			type="button"
			disabled={disabled}
			onClick={() => onClick?.({ preventDefault() {} })}
		>
			{children}
		</button>
	),
}));

vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: ({
		checked,
		onCheckedChange,
		id,
	}: {
		checked?: boolean;
		onCheckedChange?: (checked: boolean) => void;
		id?: string;
	}) => (
		<input
			id={id}
			type="checkbox"
			checked={checked}
			onChange={(event) => onCheckedChange?.(event.target.checked)}
		/>
	),
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/input-group", () => ({
	InputGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	InputGroupAddon: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	InputGroupButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button type="button" {...props} />
	),
	InputGroupInput: (props: InputHTMLAttributes<HTMLInputElement>) => (
		<input {...props} />
	),
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
		<label htmlFor={htmlFor}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => (
		<span>{placeholder}</span>
	),
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
		<div data-value={value}>{children}</div>
	),
}));

vi.mock("@/components/ui/skeleton", () => ({
	Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("@/lib/machines-store", () => ({
	useMachinesStore: () => mockMachinesState,
}));

vi.mock("@/lib/ui-store", () => ({
	useUiStore: () => mockUiState,
}));

vi.mock("@hugeicons/react", () => ({
	HugeiconsIcon: () => <span data-testid="machine-icon" />,
}));

describe("CreateSessionDialog", () => {
	beforeEach(() => {
		mockUiState.draftTitle = "Session 1";
		mockUiState.draftBackendId = "backend-1";
		mockUiState.draftCwd = "/repo/apps/webui";
		mockUiState.draftWorktreeEnabled = true;
		mockUiState.draftWorktreeBranch = "feat/live-cwd";
		mockUiState.draftWorktreeBaseBranch = "main";
		mockDebouncedValue.cwd = "/repo/apps/webui";
		mockQueryState.branches = {
			data: {
				isGitRepo: true,
				branches: [{ name: "main", current: true }],
				repoRoot: "/repo",
				repoName: "repo",
				relativeCwd: "apps/webui",
				worktreeBaseDir: "/tmp/worktrees",
			},
			isFetching: false,
			isFetched: true,
			isError: false,
		};
		vi.clearAllMocks();
	});

	it("disables create for worktree mode while the current git context is stale", () => {
		mockDebouncedValue.cwd = "/repo";

		render(
			<CreateSessionDialog
				open
				onOpenChange={vi.fn()}
				availableBackends={[
					{ backendId: "backend-1", backendLabel: "Backend 1" },
				]}
				isCreating={false}
				onCreate={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
		expect(screen.getByText("Checking project...")).toBeInTheDocument();
		expect(screen.queryByText("Project root")).not.toBeInTheDocument();
	});

	it("disables create for worktree mode while git metadata is loading for the current cwd", () => {
		mockQueryState.branches = {
			data: undefined,
			isFetching: true,
			isFetched: false,
			isError: false,
		};

		render(
			<CreateSessionDialog
				open
				onOpenChange={vi.fn()}
				availableBackends={[
					{ backendId: "backend-1", backendLabel: "Backend 1" },
				]}
				isCreating={false}
				onCreate={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
		expect(screen.getByText("Checking project...")).toBeInTheDocument();
	});

	it("renders branch display labels while keeping the raw branch name as the option value", () => {
		mockQueryState.branches = {
			data: {
				isGitRepo: true,
				branches: [
					{
						name: "main",
						displayName: "main (HEAD)",
						current: true,
					},
				],
				repoRoot: "/repo",
				repoName: "repo",
				relativeCwd: "apps/webui",
				worktreeBaseDir: "/tmp/worktrees",
			},
			isFetching: false,
			isFetched: true,
			isError: false,
		};

		render(
			<CreateSessionDialog
				open
				onOpenChange={vi.fn()}
				availableBackends={[
					{ backendId: "backend-1", backendLabel: "Backend 1" },
				]}
				isCreating={false}
				onCreate={vi.fn()}
			/>,
		);

		expect(screen.getByText("main (HEAD)")).toBeInTheDocument();
		expect(
			screen.getByText("main (HEAD)").closest("[data-value]"),
		).toHaveAttribute("data-value", "main");
	});
});
