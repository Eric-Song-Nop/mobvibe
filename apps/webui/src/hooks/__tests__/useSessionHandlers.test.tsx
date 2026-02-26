import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@/lib/chat-store";
import type { Machine } from "@/lib/machines-store";
import {
	type UseSessionHandlersParams,
	useSessionHandlers,
} from "../useSessionHandlers";

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
			getState: () => ({
				draftTitle: "",
				draftBackendId: undefined,
				draftCwd: undefined,
				draftWorktreeEnabled: false,
				draftWorktreeBranch: "",
				draftWorktreeBaseBranch: undefined,
				editingSessionId: undefined,
				editingTitle: "",
			}),
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
});
