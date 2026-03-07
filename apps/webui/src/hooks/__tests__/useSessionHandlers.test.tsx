import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "@/lib/api";
import type { ChatSession } from "@/lib/chat-store";
import type { Machine } from "@/lib/machines-store";
import {
	type UseSessionHandlersParams,
	useSessionHandlers,
} from "../useSessionHandlers";

vi.mock("@/lib/api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
	return {
		...actual,
		fetchGitBranchesForCwd: vi.fn(),
	};
});

const mockUiStoreState = vi.hoisted(() => ({
	draftTitle: "",
	draftBackendId: undefined as string | undefined,
	draftCwd: undefined as string | undefined,
	draftWorktreeEnabled: false,
	draftWorktreeBranch: "",
	draftWorktreeBaseBranch: undefined as string | undefined,
	editingSessionId: undefined as string | undefined,
	editingTitle: "",
}));

vi.mock("@/lib/chat-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-store")>();
	return {
		...actual,
		useChatStore: {
			getState: () => ({ sessions: {} }),
		},
	};
});

vi.mock("@/lib/ui-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/ui-store")>();
	return {
		...actual,
		useUiStore: {
			getState: () => mockUiStoreState,
		},
	};
});

const createMockUiActions = (): UseSessionHandlersParams["uiActions"] => ({
	setMobileMenuOpen: vi.fn(),
	setCreateDialogOpen: vi.fn(),
	setDraftTitle: vi.fn(),
	setDraftBackendId: vi.fn(),
	setDraftCwd: vi.fn(),
	resetDraftWorktree: vi.fn(),
	clearEditingSession: vi.fn(),
});

const createMockChatActions = (): UseSessionHandlersParams["chatActions"] => ({
	setAppError: vi.fn(),
	renameSession: vi.fn(),
	setError: vi.fn(),
	setSending: vi.fn(),
	setCanceling: vi.fn(),
	setInput: vi.fn(),
	setInputContents: vi.fn(),
	addUserMessage: vi.fn(),
});

const createMockMutations = (): UseSessionHandlersParams["mutations"] => ({
	createSessionMutation: {
		mutateAsync: vi.fn(),
		isPending: false,
	},
	renameSessionMutation: { mutate: vi.fn() },
	archiveSessionMutation: { mutateAsync: vi.fn() },
	bulkArchiveSessionsMutation: { mutateAsync: vi.fn(), isPending: false },
	cancelSessionMutation: { mutate: vi.fn(), mutateAsync: vi.fn() },
	setSessionModeMutation: { mutate: vi.fn(), isPending: false },
	setSessionModelMutation: { mutate: vi.fn(), isPending: false },
	sendMessageMutation: { mutate: vi.fn() },
	permissionDecisionMutation: { mutate: vi.fn() },
});

const createBaseSession = (overrides: Partial<ChatSession> = {}): ChatSession =>
	({
		sessionId: "session-1",
		machineId: "machine-1",
		backendId: "backend-1",
		cwd: "/projects/bar",
		title: "Session 1",
		isAttached: true,
		sending: false,
		canceling: false,
		isLoading: false,
		input: "",
		inputContents: [],
		messages: [],
		error: undefined,
		worktreeSourceCwd: undefined,
		...overrides,
	}) as unknown as ChatSession;

describe("useSessionHandlers — handleOpenCreateDialog", () => {
	let queryClient: QueryClient;
	let uiActions: ReturnType<typeof createMockUiActions>;
	let chatActions: ReturnType<typeof createMockChatActions>;
	let mutations: ReturnType<typeof createMockMutations>;

	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);

	const renderHandlers = (
		overrides: Partial<UseSessionHandlersParams> = {},
	) => {
		const defaults: UseSessionHandlersParams = {
			sessions: {},
			activeSessionId: undefined,
			activeSession: undefined,
			sessionList: [],
			selectedMachineId: "machine-1",
			lastCreatedCwd: {},
			machines: {
				"machine-1": {
					machineId: "machine-1",
					hostname: "dev-box",
					connected: true,
				} as Machine,
			},
			defaultBackendId: "backend-1",
			effectiveWorkspaceCwd: undefined,
			chatActions,
			uiActions,
			mutations,
			activateSession: vi.fn(),
			isActivating: false,
			syncSessionHistory: vi.fn(),
		};

		return renderHook(() => useSessionHandlers({ ...defaults, ...overrides }), {
			wrapper,
		});
	};

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		uiActions = createMockUiActions();
		chatActions = createMockChatActions();
		mutations = createMockMutations();
		mockUiStoreState.draftTitle = "";
		mockUiStoreState.draftBackendId = undefined;
		mockUiStoreState.draftCwd = undefined;
		mockUiStoreState.draftWorktreeEnabled = false;
		mockUiStoreState.draftWorktreeBranch = "";
		mockUiStoreState.draftWorktreeBaseBranch = undefined;
		mockUiStoreState.editingSessionId = undefined;
		mockUiStoreState.editingTitle = "";
		vi.clearAllMocks();
	});

	it("uses lastCreatedCwd when available (highest priority)", () => {
		const activeSession = createBaseSession({ cwd: "/projects/bar" });

		const { result } = renderHandlers({
			activeSessionId: "session-1",
			activeSession,
			lastCreatedCwd: { "machine-1": "/projects/foo" },
		});

		result.current.handleOpenCreateDialog();

		expect(uiActions.setDraftCwd).toHaveBeenCalledWith("/projects/foo");
	});

	it("falls back to active session cwd when on same machine", () => {
		const activeSession = createBaseSession({
			machineId: "machine-1",
			cwd: "/projects/bar",
			workspaceRootCwd: "/projects",
		});

		const { result } = renderHandlers({
			activeSessionId: "session-1",
			activeSession,
			lastCreatedCwd: {},
		});

		result.current.handleOpenCreateDialog();

		expect(uiActions.setDraftCwd).toHaveBeenCalledWith("/projects/bar");
	});

	it("uses worktreeSourceCwd for worktree sessions", () => {
		const activeSession = createBaseSession({
			machineId: "machine-1",
			cwd: "~/.mobvibe/worktrees/repo/feat",
			worktreeSourceCwd: "/projects/repo",
		});

		const { result } = renderHandlers({
			activeSessionId: "session-1",
			activeSession,
			lastCreatedCwd: {},
		});

		result.current.handleOpenCreateDialog();

		expect(uiActions.setDraftCwd).toHaveBeenCalledWith("/projects/repo");
	});

	it("does not use active session cwd when on different machine", () => {
		const activeSession = createBaseSession({
			machineId: "machine-2",
			cwd: "/projects/other",
		});

		const { result } = renderHandlers({
			activeSessionId: "session-1",
			activeSession,
			selectedMachineId: "machine-1",
			lastCreatedCwd: {},
		});

		result.current.handleOpenCreateDialog();

		expect(uiActions.setDraftCwd).toHaveBeenCalledWith(undefined);
	});

	it("sets undefined when no active session", () => {
		const { result } = renderHandlers({
			activeSessionId: undefined,
			activeSession: undefined,
			lastCreatedCwd: {},
		});

		result.current.handleOpenCreateDialog();

		expect(uiActions.setDraftCwd).toHaveBeenCalledWith(undefined);
	});

	it("sets undefined when no machine is selected", () => {
		const { result } = renderHandlers({
			selectedMachineId: null,
			lastCreatedCwd: {},
		});

		result.current.handleOpenCreateDialog();

		expect(uiActions.setDraftCwd).toHaveBeenCalledWith(undefined);
	});

	it('mode "workspace" uses fallback logic (same as no mode)', () => {
		const activeSession = createBaseSession({ cwd: "/projects/bar" });

		const { result } = renderHandlers({
			activeSessionId: "session-1",
			activeSession,
			lastCreatedCwd: { "machine-1": "/projects/foo" },
			effectiveWorkspaceCwd: "/projects/workspace-a",
		});

		result.current.handleOpenCreateDialog("workspace");

		// workspace mode ignores effectiveWorkspaceCwd, uses lastCreatedCwd
		expect(uiActions.setDraftCwd).toHaveBeenCalledWith("/projects/foo");
	});

	it('mode "session" uses effectiveWorkspaceCwd when available', () => {
		const { result } = renderHandlers({
			lastCreatedCwd: { "machine-1": "/projects/foo" },
			effectiveWorkspaceCwd: "/projects/workspace-a",
		});

		result.current.handleOpenCreateDialog("session");

		// session mode prefers effectiveWorkspaceCwd over lastCreatedCwd
		expect(uiActions.setDraftCwd).toHaveBeenCalledWith("/projects/workspace-a");
	});

	it('mode "session" falls back when no effectiveWorkspaceCwd', () => {
		const activeSession = createBaseSession({
			machineId: "machine-1",
			cwd: "/projects/bar",
		});

		const { result } = renderHandlers({
			activeSessionId: "session-1",
			activeSession,
			lastCreatedCwd: {},
			effectiveWorkspaceCwd: undefined,
		});

		result.current.handleOpenCreateDialog("session");

		// No workspace → falls back to activeSession cwd
		expect(uiActions.setDraftCwd).toHaveBeenCalledWith("/projects/bar");
	});

	it("prefills the active session cwd for non-worktree subdirectory sessions", () => {
		const activeSession = createBaseSession({
			machineId: "machine-1",
			cwd: "/projects/repo/apps/webui",
			workspaceRootCwd: "/projects/repo",
		});

		const { result } = renderHandlers({
			activeSessionId: "session-1",
			activeSession,
			lastCreatedCwd: {},
		});

		result.current.handleOpenCreateDialog();

		expect(uiActions.setDraftCwd).toHaveBeenCalledWith(
			"/projects/repo/apps/webui",
		);
	});
});

describe("useSessionHandlers — handleCreateSession", () => {
	let queryClient: QueryClient;
	let uiActions: ReturnType<typeof createMockUiActions>;
	let chatActions: ReturnType<typeof createMockChatActions>;
	let mutations: ReturnType<typeof createMockMutations>;

	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);

	const renderHandlers = (
		overrides: Partial<UseSessionHandlersParams> = {},
	) => {
		const defaults: UseSessionHandlersParams = {
			sessions: {},
			activeSessionId: undefined,
			activeSession: undefined,
			sessionList: [],
			selectedMachineId: "machine-1",
			lastCreatedCwd: {},
			machines: {
				"machine-1": {
					machineId: "machine-1",
					hostname: "dev-box",
					connected: true,
				} as Machine,
			},
			defaultBackendId: "backend-1",
			effectiveWorkspaceCwd: undefined,
			chatActions,
			uiActions,
			mutations,
			activateSession: vi.fn(),
			isActivating: false,
			syncSessionHistory: vi.fn(),
		};

		return renderHook(() => useSessionHandlers({ ...defaults, ...overrides }), {
			wrapper,
		});
	};

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		uiActions = createMockUiActions();
		chatActions = createMockChatActions();
		mutations = createMockMutations();
		mockUiStoreState.draftTitle = "Feature Session";
		mockUiStoreState.draftBackendId = "backend-1";
		mockUiStoreState.draftCwd = "/projects/repo/apps/webui";
		mockUiStoreState.draftWorktreeEnabled = true;
		mockUiStoreState.draftWorktreeBranch = "feat/live-cwd";
		mockUiStoreState.draftWorktreeBaseBranch = "main";
		vi.clearAllMocks();
	});

	it("refetches git metadata for the live draft cwd when worktree creation is enabled", async () => {
		vi.mocked(apiModule.fetchGitBranchesForCwd).mockResolvedValue({
			isGitRepo: true,
			branches: [],
			repoRoot: "/projects/repo",
			relativeCwd: "apps/webui",
			repoName: "repo",
			isRepoRoot: false,
		});
		vi.mocked(mutations.createSessionMutation.mutateAsync).mockResolvedValue(
			{},
		);

		const { result } = renderHandlers();

		await result.current.handleCreateSession();

		expect(apiModule.fetchGitBranchesForCwd).toHaveBeenCalledWith({
			machineId: "machine-1",
			cwd: "/projects/repo/apps/webui",
		});
		expect(mutations.createSessionMutation.mutateAsync).toHaveBeenCalledWith({
			backendId: "backend-1",
			cwd: "/projects/repo/apps/webui",
			title: "Feature Session",
			machineId: "machine-1",
			worktree: {
				branch: "feat/live-cwd",
				baseBranch: "main",
				sourceCwd: "/projects/repo",
				relativeCwd: "apps/webui",
			},
		});
	});

	it("aborts worktree creation when the live cwd is not a git repository", async () => {
		vi.mocked(apiModule.fetchGitBranchesForCwd).mockResolvedValue({
			isGitRepo: false,
			branches: [],
		});

		const { result } = renderHandlers();

		await result.current.handleCreateSession();

		expect(mutations.createSessionMutation.mutateAsync).not.toHaveBeenCalled();
		expect(chatActions.setAppError).toHaveBeenLastCalledWith(
			expect.objectContaining({
				message: "Select a Git repository before creating a worktree session",
				scope: "request",
			}),
		);
	});
});
