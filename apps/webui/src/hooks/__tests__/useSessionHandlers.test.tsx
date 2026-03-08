import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "@/lib/api";
import type { ChatSession } from "@/lib/chat-store";
import { createDefaultContentBlocks } from "@/lib/content-block-utils";
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
	draftWorktreeSuggestedBranch: undefined as string | undefined,
	draftWorktreeBaseBranch: undefined as string | undefined,
	chatDrafts: {} as Record<
		string,
		{
			input: string;
			inputContents: ReturnType<typeof createDefaultContentBlocks>;
		}
	>,
	clearChatDraft: vi.fn<(sessionId: string) => void>(),
	editingSessionId: undefined as string | undefined,
	editingTitle: "",
}));

const mockChatStoreState = vi.hoisted(() => ({
	sessions: {} as Record<string, ChatSession>,
}));

vi.mock("@/lib/chat-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-store")>();
	return {
		...actual,
		useChatStore: {
			getState: () => mockChatStoreState,
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
		mockUiStoreState.draftWorktreeSuggestedBranch = undefined;
		mockUiStoreState.draftWorktreeBaseBranch = undefined;
		mockUiStoreState.chatDrafts = {};
		mockUiStoreState.clearChatDraft.mockReset();
		mockUiStoreState.editingSessionId = undefined;
		mockUiStoreState.editingTitle = "";
		mockChatStoreState.sessions = {};
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

	it("closes the mobile menu before opening the create dialog", () => {
		const { result } = renderHandlers();

		result.current.handleOpenCreateDialog();

		expect(uiActions.setMobileMenuOpen).toHaveBeenCalledWith(false);
		expect(uiActions.setCreateDialogOpen).toHaveBeenCalledWith(true);
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
		mockUiStoreState.draftWorktreeSuggestedBranch = undefined;
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

	it("uses the suggested worktree branch when the input is blank", async () => {
		mockUiStoreState.draftWorktreeBranch = "";
		mockUiStoreState.draftWorktreeSuggestedBranch = "brisk-comet-x7";
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

		expect(mutations.createSessionMutation.mutateAsync).toHaveBeenCalledWith({
			backendId: "backend-1",
			cwd: "/projects/repo/apps/webui",
			title: "Feature Session",
			machineId: "machine-1",
			worktree: {
				branch: "brisk-comet-x7",
				baseBranch: "main",
				sourceCwd: "/projects/repo",
				relativeCwd: "apps/webui",
			},
		});
	});
});

describe("useSessionHandlers — handleSend", () => {
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
			activeSessionId: "session-1",
			activeSession: createBaseSession(),
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
		mockUiStoreState.chatDrafts = {};
		mockUiStoreState.clearChatDraft.mockReset();
		vi.clearAllMocks();
	});

	it("sends the latest prompt from the draft store and clears the draft", () => {
		const promptContents = createDefaultContentBlocks("Ship it");
		mockUiStoreState.chatDrafts["session-1"] = {
			input: "Ship it",
			inputContents: promptContents,
		};

		const { result } = renderHandlers({
			activeSession: createBaseSession({
				input: "",
				inputContents: createDefaultContentBlocks("stale"),
			}),
		});

		act(() => {
			result.current.handleSend();
		});

		expect(chatActions.setSending).toHaveBeenCalledWith("session-1", true);
		expect(chatActions.setCanceling).toHaveBeenCalledWith("session-1", false);
		expect(chatActions.setError).toHaveBeenCalledWith("session-1", undefined);
		expect(mockUiStoreState.clearChatDraft).toHaveBeenCalledWith("session-1");
		expect(chatActions.addUserMessage).toHaveBeenCalledWith(
			"session-1",
			"Ship it",
			expect.objectContaining({
				contentBlocks: promptContents,
				provisional: true,
			}),
		);
		expect(mutations.sendMessageMutation.mutate).toHaveBeenCalledWith({
			sessionId: "session-1",
			prompt: promptContents,
		});
	});

	it("does not send when the draft contains only whitespace", () => {
		mockUiStoreState.chatDrafts["session-1"] = {
			input: "   ",
			inputContents: createDefaultContentBlocks("   "),
		};

		const { result } = renderHandlers();

		act(() => {
			result.current.handleSend();
		});

		expect(chatActions.setSending).not.toHaveBeenCalled();
		expect(mutations.sendMessageMutation.mutate).not.toHaveBeenCalled();
		expect(mockUiStoreState.clearChatDraft).not.toHaveBeenCalled();
	});

	it("sends resource-only prompts from the draft store", () => {
		const promptContents: ChatSession["inputContents"] = [
			{
				type: "resource_link",
				uri: "file:///repo/README.md",
				name: "README.md",
			},
		];
		mockUiStoreState.chatDrafts["session-1"] = {
			input: "",
			inputContents: promptContents,
		};

		const { result } = renderHandlers({
			activeSession: createBaseSession({
				input: "",
				inputContents: createDefaultContentBlocks("stale"),
			}),
		});

		act(() => {
			result.current.handleSend();
		});

		expect(mockUiStoreState.clearChatDraft).toHaveBeenCalledWith("session-1");
		expect(chatActions.addUserMessage).toHaveBeenCalledWith(
			"session-1",
			"",
			expect.objectContaining({
				contentBlocks: promptContents,
				provisional: true,
			}),
		);
		expect(mutations.sendMessageMutation.mutate).toHaveBeenCalledWith({
			sessionId: "session-1",
			prompt: promptContents,
		});
	});
});

describe("useSessionHandlers — sync and force reload", () => {
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
			activeSessionId: "session-1",
			activeSession: createBaseSession(),
			sessionList: [],
			selectedMachineId: "machine-1",
			lastCreatedCwd: {},
			machines: {
				"machine-1": {
					machineId: "machine-1",
					hostname: "dev-box",
					connected: true,
					backendCapabilities: {
						"backend-1": {
							list: true,
							load: true,
						},
					},
				} as Machine,
			},
			defaultBackendId: "backend-1",
			effectiveWorkspaceCwd: undefined,
			chatActions,
			uiActions,
			mutations,
			activateSession: vi.fn(async () => undefined),
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
		mockChatStoreState.sessions = {};
		vi.clearAllMocks();
	});

	it("syncs history for the active session", () => {
		const syncSessionHistory = vi.fn();
		const { result } = renderHandlers({ syncSessionHistory });

		result.current.handleSyncHistory();

		expect(syncSessionHistory).toHaveBeenCalledWith("session-1");
	});

	it("does not sync history when there is no active session", () => {
		const syncSessionHistory = vi.fn();
		const { result } = renderHandlers({
			activeSessionId: undefined,
			activeSession: undefined,
			syncSessionHistory,
		});

		result.current.handleSyncHistory();

		expect(syncSessionHistory).not.toHaveBeenCalled();
	});

	it("force reloads the latest session snapshot", async () => {
		const activeSession = createBaseSession({
			title: "Stale title",
			sending: false,
		});
		const latestSession = createBaseSession({
			title: "Latest title",
			sending: false,
		});
		mockChatStoreState.sessions = {
			"session-1": latestSession,
		};
		const activateSession = vi.fn(async () => undefined);
		const { result } = renderHandlers({
			activeSession,
			activateSession,
		});

		await act(async () => {
			await result.current.handleForceReload();
		});

		expect(activateSession).toHaveBeenCalledWith(latestSession, {
			force: true,
		});
		expect(mutations.cancelSessionMutation.mutateAsync).not.toHaveBeenCalled();
	});

	it("cancels an active send before force reload", async () => {
		const activeSession = createBaseSession({
			sending: true,
			canceling: false,
			isAttached: true,
		});
		mockChatStoreState.sessions = {
			"session-1": activeSession,
		};
		const activateSession = vi.fn(async () => undefined);
		vi.mocked(mutations.cancelSessionMutation.mutateAsync).mockResolvedValue({
			sessionId: "session-1",
		});
		const { result } = renderHandlers({
			activeSession,
			activateSession,
		});

		await act(async () => {
			await result.current.handleForceReload();
		});

		expect(mutations.cancelSessionMutation.mutateAsync).toHaveBeenCalledWith({
			sessionId: "session-1",
		});
		expect(activateSession).toHaveBeenCalledWith(activeSession, {
			force: true,
		});
	});

	it("does not force reload while already loading", async () => {
		const activateSession = vi.fn(async () => undefined);
		const { result } = renderHandlers({
			activeSession: createBaseSession({ isLoading: true }),
			activateSession,
		});

		await act(async () => {
			await result.current.handleForceReload();
		});

		expect(activateSession).not.toHaveBeenCalled();
	});

	it("does not force reload when backend load is unsupported", async () => {
		const activateSession = vi.fn(async () => undefined);
		const { result } = renderHandlers({
			machines: {
				"machine-1": {
					machineId: "machine-1",
					hostname: "dev-box",
					connected: true,
					backendCapabilities: {
						"backend-1": {
							list: true,
							load: false,
						},
					},
				} as Machine,
			},
			activateSession,
		});

		await act(async () => {
			await result.current.handleForceReload();
		});

		expect(activateSession).not.toHaveBeenCalled();
	});
});
