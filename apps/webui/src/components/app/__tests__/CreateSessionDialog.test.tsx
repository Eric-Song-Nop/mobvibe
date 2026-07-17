import { fireEvent, render, screen } from "@testing-library/react";
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
	draftAdditionalDirectories: [] as string[],
	draftWorktreeEnabled: true,
	draftWorktreeBranch: "feat/live-cwd",
	draftWorktreeSuggestedBranch: "brisk-comet-x7",
	draftWorktreeBaseBranch: "main",
	setDraftTitle: vi.fn(),
	setDraftBackendId: vi.fn(),
	setDraftCwd: vi.fn(),
	setDraftAdditionalDirectories: vi.fn(),
	setDraftWorktreeEnabled: vi.fn(),
	setDraftWorktreeBranch: vi.fn(),
	setDraftWorktreeSuggestedBranch: vi.fn(),
	setDraftWorktreeBaseBranch: vi.fn(),
}));

const mockMachinesState = vi.hoisted(() => ({
	selectedMachineId: "machine-1",
	machines: {
		"machine-1": {
			machineId: "machine-1",
			hostname: "dev-box",
			connected: true,
			backendCapabilities: {
				"backend-1": {
					list: true,
					load: true,
					additionalDirectories: false,
				},
			},
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
				"session.additionalDirectories.label": "Additional directories",
				"session.additionalDirectories.description": "Other roots",
				"session.additionalDirectories.browse": "Add directory",
				"session.additionalDirectories.remove": "Remove",
				"session.additionalDirectories.dialogTitle": "Add directory",
				"session.additionalDirectories.dialogDescription": "Choose a root",
				"session.additionalDirectories.add": "Add directory",
				"session.projectDetection.checking": "Checking project...",
				"session.projectDetection.repoRoot": "Project root",
				"session.projectDetection.relativeCwd": "Selected subdirectory",
				"session.projectDetection.folder": "Folder detected",
				"session.projectDetection.gitRepo": `Git repo detected: ${options?.name ?? ""}`,
				"session.projectDetection.nonGitHint": "Non-git folder",
				"session.worktree.enable": "Create in new worktree",
				"session.worktree.branchLabel": "New branch",
				"session.worktree.branchPlaceholder":
					"Leave blank for a random name, or enter feat/my-feature…",
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

vi.mock("@mobvibe/shared", async () => {
	const actual =
		await vi.importActual<typeof import("@mobvibe/shared")>("@mobvibe/shared");
	return {
		...actual,
		generateDefaultWorktreeBranchName: () => "brisk-comet-x7",
		sanitizeWorktreeBranchForPath: (branch: string) =>
			branch.replace(/[/\\]/g, "-"),
	};
});

vi.mock("@/components/app/WorkingDirectoryDialog", () => ({
	WorkingDirectoryDialog: ({
		open,
		onChange,
		onConfirm,
	}: {
		open: boolean;
		onChange: (path: string) => void;
		onConfirm?: (path: string) => void;
	}) =>
		open && onConfirm ? (
			<button
				type="button"
				onClick={() => {
					onChange("/shared");
					onConfirm("/shared");
				}}
			>
				Choose shared
			</button>
		) : null,
}));

vi.mock("@mobvibe/ui/dialog", () => ({
	Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@mobvibe/ui/button", () => ({
	Button: ({
		children,
		disabled,
		onClick,
		"aria-label": ariaLabel,
	}: {
		children: ReactNode;
		disabled?: boolean;
		onClick?: () => void;
		"aria-label"?: string;
	}) => (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			aria-label={ariaLabel}
		>
			{children}
		</button>
	),
}));

vi.mock("@mobvibe/ui/checkbox", () => ({
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

vi.mock("@mobvibe/ui/input", () => ({
	Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@mobvibe/ui/input-group", () => ({
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

vi.mock("@mobvibe/ui/label", () => ({
	Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
		<label htmlFor={htmlFor}>{children}</label>
	),
}));

vi.mock("@mobvibe/ui/select", () => ({
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

vi.mock("@mobvibe/ui/skeleton", () => ({
	Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("@/lib/machines-store", () => ({
	useMachinesStore: () => mockMachinesState,
	getBackendCapability: (
		machine: (typeof mockMachinesState.machines)["machine-1"] | undefined,
		backendId: string | undefined,
		capability: "list" | "load" | "additionalDirectories",
	) => {
		const capabilities = machine?.backendCapabilities as
			| Record<
					string,
					{ list: boolean; load: boolean; additionalDirectories: boolean }
			  >
			| undefined;
		return backendId ? capabilities?.[backendId]?.[capability] : undefined;
	},
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
		mockUiState.draftAdditionalDirectories = [];
		mockMachinesState.machines["machine-1"].backendCapabilities[
			"backend-1"
		].additionalDirectories = false;
		mockUiState.draftWorktreeEnabled = true;
		mockUiState.draftWorktreeBranch = "feat/live-cwd";
		mockUiState.draftWorktreeSuggestedBranch = "brisk-comet-x7";
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

	it("shows additional directory controls only when the backend advertises support", () => {
		const props = {
			open: true,
			onOpenChange: vi.fn(),
			availableBackends: [
				{ backendId: "backend-1", backendLabel: "Backend 1" },
			],
			isCreating: false,
			onCreate: vi.fn(),
		};
		const { rerender } = render(<CreateSessionDialog {...props} />);
		expect(
			screen.queryByText("Additional directories"),
		).not.toBeInTheDocument();

		mockMachinesState.machines["machine-1"].backendCapabilities[
			"backend-1"
		].additionalDirectories = true;
		rerender(<CreateSessionDialog {...props} />);
		expect(screen.getByText("Additional directories")).toBeInTheDocument();
	});

	it("adds and removes ordered additional directory drafts", () => {
		mockMachinesState.machines["machine-1"].backendCapabilities[
			"backend-1"
		].additionalDirectories = true;
		mockUiState.draftAdditionalDirectories = ["/data"];

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

		fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
		fireEvent.click(screen.getByRole("button", { name: "Choose shared" }));
		expect(mockUiState.setDraftAdditionalDirectories).toHaveBeenCalledWith([
			"/data",
			"/shared",
		]);

		fireEvent.click(screen.getByRole("button", { name: "Remove /data" }));
		expect(mockUiState.setDraftAdditionalDirectories).toHaveBeenCalledWith([]);
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

	it("keeps create enabled and shows the suggested path when the branch input is blank", () => {
		mockUiState.draftWorktreeBranch = "";

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

		expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
		expect(
			screen.getByText("/tmp/worktrees/repo/brisk-comet-x7"),
		).toBeInTheDocument();
	});

	it("autofills the suggested branch when worktree mode starts with an empty branch", () => {
		mockUiState.draftWorktreeBranch = "";

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

		expect(mockUiState.setDraftWorktreeBranch).toHaveBeenCalledWith(
			"brisk-comet-x7",
		);
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
