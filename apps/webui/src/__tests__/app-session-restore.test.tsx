import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { useChatStore } from "@/lib/chat-store";
import { useMachinesStore } from "@/lib/machines-store";
import { useTeamStore } from "@/lib/team-store";
import { useUiStore } from "@/lib/ui-store";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const sessionsState = vi.hoisted(() => ({
	sessionsQuery: {
		data: { sessions: [] } as {
			sessions: Array<Record<string, unknown>>;
			coveredMachineIds?: string[];
		},
		isError: false,
	},
	backendsQuery: {
		data: { backends: [{ backendId: "backend-1", backendLabel: "Claude" }] },
		isError: false,
	},
}));
const mockRefreshSessionQueriesAfterReconnect = vi.hoisted(() =>
	vi.fn(async () => {}),
);

const handlers = vi.hoisted(
	() => ({}) as Record<string, ((payload?: unknown) => void) | undefined>,
);

const subscribedSessions = vi.hoisted(() => new Set<string>());
const dekReadyListeners = vi.hoisted(
	() => new Set<(sessionId: string) => void>(),
);
const decryptedPayloads = vi.hoisted(
	() => new Map<string, Record<string, unknown>>(),
);

const emitDekReady = (sessionId: string) => {
	for (const listener of dekReadyListeners) {
		listener(sessionId);
	}
};

const createStoredSession = (overrides: Record<string, unknown> = {}) => ({
	sessionId: "session-1",
	title: "Stored Session",
	input: "",
	inputContents: [],
	messages: [],
	terminalOutputs: {},
	sending: false,
	canceling: false,
	isAttached: true,
	isLoading: false,
	backendId: "backend-1",
	backendLabel: "Claude",
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-01T00:00:00Z",
	machineId: "machine-1",
	cwd: "/repo",
	revision: 1,
	lastAppliedSeq: 0,
	...overrides,
});

vi.mock("@/hooks/useSessionQueries", () => ({
	refreshSessionQueriesAfterReconnect: mockRefreshSessionQueriesAfterReconnect,
	useSessionQueries: () => ({
		sessionsQuery: sessionsState.sessionsQuery,
		backendsQuery: sessionsState.backendsQuery,
		availableBackends: sessionsState.backendsQuery.data.backends,
		discoverSessionsMutation: {
			mutate: vi.fn(),
			mutateAsync: vi.fn(),
			isPending: false,
		},
	}),
}));

vi.mock("@/hooks/useSessionMutations", () => ({
	useSessionMutations: () => ({
		createSessionMutation: { isPending: false, mutateAsync: vi.fn() },
		createAgentTeamRunMutation: { isPending: false, mutateAsync: vi.fn() },
		renameSessionMutation: { mutate: vi.fn() },
		archiveSessionMutation: { mutateAsync: vi.fn() },
		bulkArchiveSessionsMutation: { mutateAsync: vi.fn() },
		cancelSessionMutation: { mutate: vi.fn() },
		setSessionModeMutation: { mutate: vi.fn(), isPending: false },
		setSessionModelMutation: { mutate: vi.fn(), isPending: false },
		setSessionConfigOptionMutation: { mutate: vi.fn(), isPending: false },
		sendMessageMutation: { mutate: vi.fn() },
		permissionDecisionMutation: { mutate: vi.fn() },
		loadSessionMutation: { isPending: false, mutateAsync: vi.fn() },
		reloadSessionMutation: { isPending: false, mutateAsync: vi.fn() },
		discoverSessionsMutation: { mutate: vi.fn(), isPending: false },
	}),
}));

vi.mock("@/hooks/useMachineDiscovery", () => ({
	useMachineDiscovery: () => undefined,
}));

vi.mock("@/hooks/useMachinesQuery", () => ({
	useMachinesQuery: () => ({
		data: { machines: [] },
		isError: false,
	}),
}));

vi.mock("@/hooks/useSessionActivation", () => ({
	useSessionActivation: () => ({
		activateSession: vi.fn(),
		activationState: { phase: "idle" },
		isActivating: false,
	}),
}));

vi.mock("@/hooks/useSessionHandlers", () => ({
	useSessionHandlers: () => ({
		isForceReloading: false,
		isBulkArchiving: false,
		handleOpenCreateDialog: vi.fn(),
		handleCreateSession: vi.fn(),
		handleRenameSubmit: vi.fn(),
		handleArchiveSession: vi.fn(),
		handleBulkArchiveSessions: vi.fn(),
		handlePermissionDecision: vi.fn(),
		handleModeChange: vi.fn(),
		handleModelChange: vi.fn(),
		handleSessionConfigChange: vi.fn(),
		handleCancel: vi.fn(),
		handleForceReload: vi.fn(),
		handleSyncHistory: vi.fn(),
		handleSend: vi.fn(),
	}),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
	useAuth: () => ({
		isAuthenticated: false,
		isLoading: false,
		isAuthEnabled: false,
		user: null,
		signIn: vi.fn(),
		signUp: vi.fn(),
		signOut: vi.fn(),
	}),
	AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@daveyplate/better-auth-tauri/react", () => ({
	useBetterAuthTauri: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth")>();
	return {
		...actual,
		isInTauri: () => false,
		getAuthClient: () => null,
	};
});

vi.mock("@/components/app/AppHeader", () => ({
	AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("@/components/app/AppSidebar", () => ({
	AppSidebar: () => <div data-testid="app-sidebar" />,
}));

vi.mock("@/components/machines/MachinesSidebar", () => ({
	MachinesSidebar: () => <div data-testid="machines-sidebar" />,
}));

vi.mock("@/components/app/ChatFooter", () => ({
	ChatFooter: () => <div data-testid="chat-footer" />,
}));

vi.mock("@/components/app/CreateSessionDialog", () => ({
	CreateSessionDialog: () => null,
}));

vi.mock("@/components/app/CommandPalette", () => ({
	CommandPalette: () => null,
}));

vi.mock("@/components/app/FileExplorerDialog", () => ({
	FileExplorerDialog: () => null,
}));

vi.mock("@/components/chat/ChatSearchBar", () => ({
	ChatSearchBar: () => null,
}));

vi.mock("@/components/ui/toaster", () => ({
	Toaster: () => null,
}));

vi.mock("@/components/app/ChatMessageList", () => ({
	ChatMessageList: ({
		activeSession,
	}: {
		activeSession?: { title?: string; messages?: Array<{ content?: string }> };
	}) => (
		<div data-testid="chat-message-list">
			<div data-testid="active-session-title">{activeSession?.title ?? ""}</div>
			<div data-testid="message-count">
				{String(activeSession?.messages?.length ?? 0)}
			</div>
			{activeSession?.messages?.map((message, index) => (
				<div key={`${index}-${message.content ?? ""}`}>{message.content}</div>
			))}
		</div>
	),
}));

const mockGatewaySocket = vi.hoisted(() => ({
	connect: vi.fn(),
	disconnect: vi.fn(),
	destroy: vi.fn(),
	isConnected: vi.fn(() => true),
	subscribeToSession: vi.fn((sessionId: string) => {
		subscribedSessions.add(sessionId);
	}),
	unsubscribeFromSession: vi.fn((sessionId: string) => {
		subscribedSessions.delete(sessionId);
	}),
	getSubscribedSessions: vi.fn(() => Array.from(subscribedSessions)),
	getGatewayUrl: vi.fn(() => "http://localhost:3005"),
	onSessionEvent: vi.fn((handler: (payload: unknown) => void) => {
		handlers.sessionEvent = handler;
		return () => {
			handlers.sessionEvent = undefined;
		};
	}),
	onPermissionRequest: vi.fn((handler: (payload: unknown) => void) => {
		handlers.permissionRequest = handler;
		return () => {
			handlers.permissionRequest = undefined;
		};
	}),
	onPermissionResult: vi.fn((handler: (payload: unknown) => void) => {
		handlers.permissionResult = handler;
		return () => {
			handlers.permissionResult = undefined;
		};
	}),
	onSessionsChanged: vi.fn((handler: (payload: unknown) => void) => {
		handlers.sessionsChanged = handler;
		return () => {
			handlers.sessionsChanged = undefined;
		};
	}),
	onAgentTeamsChanged: vi.fn((handler: (payload: unknown) => void) => {
		handlers.agentTeamsChanged = handler;
		return () => {
			handlers.agentTeamsChanged = undefined;
		};
	}),
	onAgentTeamsRefreshRequired: vi.fn((handler: (payload: unknown) => void) => {
		handlers.agentTeamsRefreshRequired = handler;
		return () => {
			handlers.agentTeamsRefreshRequired = undefined;
		};
	}),
	onSessionAttached: vi.fn((handler: (payload: unknown) => void) => {
		handlers.sessionAttached = handler;
		return () => {
			handlers.sessionAttached = undefined;
		};
	}),
	onSessionDetached: vi.fn((handler: (payload: unknown) => void) => {
		handlers.sessionDetached = handler;
		return () => {
			handlers.sessionDetached = undefined;
		};
	}),
	onCliStatus: vi.fn((handler: (payload: unknown) => void) => {
		handlers.cliStatus = handler;
		return () => {
			handlers.cliStatus = undefined;
		};
	}),
	onDisconnect: vi.fn((handler: (payload: unknown) => void) => {
		handlers.disconnect = handler;
		return () => {
			handlers.disconnect = undefined;
		};
	}),
	onConnect: vi.fn((handler: () => void) => {
		handlers.connect = handler;
		return () => {
			handlers.connect = undefined;
		};
	}),
}));

vi.mock("@/lib/socket", () => ({
	gatewaySocket: mockGatewaySocket,
}));

const mockE2EE = vi.hoisted(() => ({
	hasSessionDek: vi.fn(() => true),
	decryptEvent: vi.fn((event: { payload: unknown }) => {
		if (
			event.payload &&
			typeof event.payload === "object" &&
			"c" in (event.payload as Record<string, unknown>)
		) {
			const encryptedId = (event.payload as Record<string, string>).c;
			const decrypted = decryptedPayloads.get(encryptedId);
			if (decrypted) {
				return { ...event, payload: decrypted };
			}
		}
		return event;
	}),
	onDekReady: vi.fn((listener: (sessionId: string) => void) => {
		dekReadyListeners.add(listener);
		return () => {
			dekReadyListeners.delete(listener);
		};
	}),
	unwrapSessionDek: vi.fn(),
	unwrapAllSessionDeks: vi.fn(),
	getSessionE2EEStatus: vi.fn(
		(_sessionId: string, _hasWrappedDek: boolean) => "ready",
	),
	setPairedSecret: vi.fn(async () => undefined),
}));

vi.mock("@/lib/e2ee", () => ({
	e2ee: mockE2EE,
	bootstrapSessionE2EE: vi.fn((sessionId: string, wrappedDek?: string) => {
		if (wrappedDek) {
			mockE2EE.unwrapSessionDek(sessionId, wrappedDek);
		}
		return mockE2EE.getSessionE2EEStatus(sessionId, Boolean(wrappedDek));
	}),
}));

vi.mock("@/lib/notifications", () => ({
	ensureNotificationPermission: vi.fn(),
	notifyPermissionRequest: vi.fn(),
	notifyResponseCompleted: vi.fn(),
	notifySessionError: vi.fn(),
}));

const renderApp = () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});
	const createApp = () => (
		<MemoryRouter initialEntries={["/"]}>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</MemoryRouter>
	);
	const renderResult = render(createApp());

	return {
		...renderResult,
		queryClient,
		rerenderApp: () => renderResult.rerender(createApp()),
	};
};

describe("App session restore integration", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 2,
					events: [],
					hasMore: false,
				}),
		});
		sessionsState.sessionsQuery = {
			data: { sessions: [] },
			isError: false,
		};
		sessionsState.backendsQuery = {
			data: { backends: [{ backendId: "backend-1", backendLabel: "Claude" }] },
			isError: false,
		};
		subscribedSessions.clear();
		dekReadyListeners.clear();
		decryptedPayloads.clear();
		for (const key of Object.keys(handlers)) {
			delete handlers[key];
		}
		mockGatewaySocket.connect.mockReset();
		mockGatewaySocket.disconnect.mockReset();
		mockGatewaySocket.destroy.mockReset();
		mockGatewaySocket.isConnected.mockReset();
		mockGatewaySocket.isConnected.mockReturnValue(true);
		mockGatewaySocket.subscribeToSession.mockClear();
		mockGatewaySocket.unsubscribeFromSession.mockClear();
		mockE2EE.hasSessionDek.mockReset();
		mockE2EE.hasSessionDek.mockReturnValue(true);
		mockE2EE.decryptEvent.mockClear();
		mockE2EE.unwrapSessionDek.mockReset();
		mockE2EE.unwrapAllSessionDeks.mockReset();
		mockE2EE.getSessionE2EEStatus.mockReset();
		mockE2EE.getSessionE2EEStatus.mockReturnValue("ready");
		mockE2EE.setPairedSecret.mockClear();
		mockRefreshSessionQueriesAfterReconnect.mockClear();

		useChatStore.setState({
			sessions: {},
			activeSessionId: undefined,
			appError: undefined,
			lastCreatedCwd: {},
			syncStatus: "idle",
			lastSyncAt: undefined,
		});
		useMachinesStore.setState({
			machines: {
				"machine-1": {
					machineId: "machine-1",
					hostname: "local",
					connected: true,
				},
			},
			selectedMachineId: "machine-1",
		});
		useTeamStore.setState({
			teams: {},
			activeAgentTeamId: undefined,
			appError: undefined,
			isProjectionReady: true,
			isProjectionRefreshing: false,
			isProjectionUnavailable: false,
			isSessionProjectionRecoveryPending: false,
			isSessionProjectionSnapshotReady: false,
			sessionProjectionRecoveryGeneration: 0,
			lastAbortedSessionProjectionRecoveryGeneration: undefined,
		});
		useUiStore.setState({
			selectedWorkspaceByMachine: {},
			createDialogOpen: false,
			fileExplorerOpen: false,
			filePreviewPath: undefined,
			commandPaletteOpen: false,
			chatSearchOpen: false,
		});
	});

	it("refreshes the authoritative Team snapshot when a CLI registers", async () => {
		renderApp();

		await act(async () => {
			handlers.agentTeamsRefreshRequired?.({ reason: "cli_registered" });
		});

		expect(mockRefreshSessionQueriesAfterReconnect).toHaveBeenCalledTimes(1);
		expect(mockRefreshSessionQueriesAfterReconnect).toHaveBeenCalledWith(
			expect.any(QueryClient),
		);
	});

	it("surfaces an authoritative recovery failure without an unhandled rejection", async () => {
		mockRefreshSessionQueriesAfterReconnect.mockRejectedValueOnce(
			new Error("Team recovery unavailable"),
		);
		renderApp();

		await act(async () => {
			handlers.agentTeamsRefreshRequired?.({ reason: "cli_registered" });
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(useTeamStore.getState().appError).toEqual(
				expect.objectContaining({
					code: "INTERNAL_ERROR",
					retryable: true,
					scope: "service",
				}),
			);
		});
	});

	it("commits the snapshot before releasing and replaying buffered deltas", async () => {
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						sessionId: "recovered-session",
						title: "HTTP Snapshot",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
						cwd: "/repo",
						revision: 1,
						isAttached: true,
					},
				],
			},
			isError: false,
		};
		const generation = useTeamStore.getState().beginSessionProjectionRecovery();

		renderApp();
		await act(async () => {
			await Promise.resolve();
		});
		const recoveryReleased = vi.fn();
		const unsubscribe = useTeamStore.subscribe((state, previousState) => {
			if (
				previousState.isSessionProjectionRecoveryPending &&
				!state.isSessionProjectionRecoveryPending
			) {
				recoveryReleased();
			}
		});

		expect(
			useChatStore.getState().sessions["recovered-session"],
		).toBeUndefined();
		act(() => {
			handlers.sessionsChanged?.({
				machineId: "machine-1",
				added: [],
				updated: [
					{
						...sessionsState.sessionsQuery.data.sessions[0],
						title: "Socket Delta",
					},
				],
				removed: [],
			});
		});
		expect(
			useChatStore.getState().sessions["recovered-session"],
		).toBeUndefined();

		act(() => {
			useTeamStore.getState().markSessionProjectionSnapshotReady(generation);
		});
		await waitFor(() => {
			expect(useChatStore.getState().sessions["recovered-session"]?.title).toBe(
				"Socket Delta",
			);
		});
		expect(useTeamStore.getState().isSessionProjectionRecoveryPending).toBe(
			false,
		);
		expect(recoveryReleased).toHaveBeenCalledOnce();
		expect(mockE2EE.getSessionE2EEStatus).toHaveBeenCalled();
		expect(
			mockE2EE.getSessionE2EEStatus.mock.invocationCallOrder[0],
		).toBeLessThan(
			recoveryReleased.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
		unsubscribe();
	});

	it("commits the QueryClient recovery snapshot before the observer catches up", async () => {
		const observerSnapshot = {
			sessionId: "observer-stale",
			title: "Observer stale",
			backendId: "backend-1",
			backendLabel: "Claude",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-01T00:00:00Z",
			machineId: "machine-1",
			cwd: "/repo",
			revision: 1,
			isAttached: true,
		};
		const cachedSnapshot = {
			...observerSnapshot,
			sessionId: "cache-current",
			title: "Cache current",
		};
		sessionsState.sessionsQuery = {
			data: {
				sessions: [observerSnapshot],
				coveredMachineIds: ["machine-1"],
			},
			isError: false,
		};
		const generation = useTeamStore.getState().beginSessionProjectionRecovery();
		const { queryClient } = renderApp();
		await act(async () => {
			await Promise.resolve();
		});

		queryClient.setQueryData(["sessions"], {
			sessions: [cachedSnapshot],
			coveredMachineIds: ["machine-1"],
		});
		act(() => {
			handlers.sessionsChanged?.({
				machineId: "machine-1",
				added: [{ ...cachedSnapshot, title: "Socket after cache" }],
				updated: [],
				removed: [],
			});
			useTeamStore.getState().markSessionProjectionSnapshotReady(generation);
		});

		await waitFor(() => {
			expect(useChatStore.getState().sessions["cache-current"]?.title).toBe(
				"Socket after cache",
			);
		});
		expect(useChatStore.getState().sessions["observer-stale"]).toBeUndefined();
		expect(useTeamStore.getState().isSessionProjectionRecoveryPending).toBe(
			false,
		);
	});

	it("replaces only covered machine session slices from HTTP", async () => {
		useChatStore.setState({
			sessions: {
				"covered-stale": createStoredSession({
					sessionId: "covered-stale",
					title: "Covered stale",
					machineId: "machine-1",
				}),
				"offline-session": createStoredSession({
					sessionId: "offline-session",
					title: "Offline retained",
					machineId: "machine-offline",
				}),
			},
		});
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						sessionId: "covered-current",
						title: "Covered current",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
						cwd: "/repo",
						revision: 1,
						isAttached: false,
					},
				],
				coveredMachineIds: ["machine-1"],
			},
			isError: false,
		};

		renderApp();

		await waitFor(() => {
			expect(useChatStore.getState().sessions["covered-current"]?.title).toBe(
				"Covered current",
			);
		});
		expect(useChatStore.getState().sessions["covered-stale"]).toBeUndefined();
		expect(useChatStore.getState().sessions["offline-session"]?.title).toBe(
			"Offline retained",
		);
	});

	it("preserves last-good state and skips E2EE bootstrap for cross-source HTTP collisions", async () => {
		useChatStore.setState({
			sessions: {
				collision: createStoredSession({
					sessionId: "collision",
					title: "Last good collision",
					machineId: "machine-1",
					revision: 1,
					isAttached: false,
				}),
			},
		});
		const baseSummary = {
			sessionId: "collision",
			title: "Conflicting snapshot",
			backendId: "backend-1",
			backendLabel: "Claude",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-02T00:00:00Z",
			revision: 2,
			isAttached: true,
		};
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						...baseSummary,
						machineId: "machine-1",
						wrappedDek: "wrapped-machine-1",
					},
					{
						...baseSummary,
						machineId: "machine-2",
						wrappedDek: "wrapped-machine-2",
					},
					{
						...baseSummary,
						sessionId: "ordinary",
						title: "Ordinary accepted",
						machineId: "machine-1",
						wrappedDek: "wrapped-ordinary",
					},
				],
				coveredMachineIds: ["machine-1", "machine-2"],
			},
			isError: false,
		};

		renderApp();

		await waitFor(() => {
			expect(useChatStore.getState().sessions.ordinary?.title).toBe(
				"Ordinary accepted",
			);
		});
		expect(useChatStore.getState().sessions.collision?.title).toBe(
			"Last good collision",
		);
		expect(mockE2EE.unwrapSessionDek).toHaveBeenCalledWith(
			"ordinary",
			"wrapped-ordinary",
		);
		expect(mockE2EE.unwrapSessionDek).not.toHaveBeenCalledWith(
			"collision",
			expect.any(String),
		);
	});

	it("derives coverage when the HTTP coverage field is not an array", async () => {
		useChatStore.setState({
			sessions: {
				"machine-1-stale": createStoredSession({
					sessionId: "machine-1-stale",
					machineId: "machine-1",
					isAttached: false,
				}),
				"offline-session": createStoredSession({
					sessionId: "offline-session",
					machineId: "machine-offline",
					isAttached: false,
				}),
			},
		});
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						sessionId: "machine-1-current",
						title: "Machine 1 current",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
					},
				],
				coveredMachineIds: {
					malformed: true,
				} as unknown as string[],
			},
			isError: false,
		};

		renderApp();

		await waitFor(() => {
			expect(
				useChatStore.getState().sessions["machine-1-current"],
			).toBeDefined();
		});
		expect(useChatStore.getState().sessions["machine-1-stale"]).toBeUndefined();
		expect(useChatStore.getState().sessions["offline-session"]).toBeDefined();
	});

	it("derives missing coverage from all represented machine slices", async () => {
		useChatStore.setState({
			sessions: {
				"machine-1-stale": createStoredSession({
					sessionId: "machine-1-stale",
					machineId: "machine-1",
					isAttached: false,
				}),
				"machine-2-stale": createStoredSession({
					sessionId: "machine-2-stale",
					machineId: "machine-2",
					isAttached: false,
				}),
				"offline-session": createStoredSession({
					sessionId: "offline-session",
					machineId: "machine-offline",
					isAttached: false,
				}),
			},
		});
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						sessionId: "machine-1-current",
						title: "Machine 1 current",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
					},
					{
						sessionId: "machine-2-current",
						title: "Machine 2 current",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-2",
					},
				],
			},
			isError: false,
		};

		renderApp();

		await waitFor(() => {
			expect(
				useChatStore.getState().sessions["machine-1-current"],
			).toBeDefined();
			expect(
				useChatStore.getState().sessions["machine-2-current"],
			).toBeDefined();
		});
		expect(useChatStore.getState().sessions["machine-1-stale"]).toBeUndefined();
		expect(useChatStore.getState().sessions["machine-2-stale"]).toBeUndefined();
		expect(useChatStore.getState().sessions["offline-session"]).toBeDefined();
	});

	it("treats missing coverage with an empty snapshot as a no-op", async () => {
		useChatStore.setState({
			sessions: {
				"persisted-session": createStoredSession({
					sessionId: "persisted-session",
					machineId: "machine-offline",
					isAttached: false,
				}),
			},
		});
		sessionsState.sessionsQuery = {
			data: { sessions: [] },
			isError: false,
		};

		renderApp();
		await act(async () => {
			await Promise.resolve();
		});

		expect(useChatStore.getState().sessions["persisted-session"]).toBeDefined();
	});

	it("applies coverage changes when React Query reuses an empty sessions array", async () => {
		const sharedEmptySnapshot: Array<Record<string, unknown>> = [];
		useChatStore.setState({
			sessions: {
				"machine-2-stale": createStoredSession({
					sessionId: "machine-2-stale",
					title: "Machine 2 stale",
					machineId: "machine-2",
					isAttached: false,
				}),
			},
		});
		sessionsState.sessionsQuery = {
			data: {
				sessions: sharedEmptySnapshot,
				coveredMachineIds: ["machine-1"],
			},
			isError: false,
		};
		const { rerenderApp } = renderApp();

		await waitFor(() => {
			expect(useChatStore.getState().sessions["machine-2-stale"]).toBeDefined();
		});

		sessionsState.sessionsQuery = {
			data: {
				sessions: sharedEmptySnapshot,
				coveredMachineIds: ["machine-2"],
			},
			isError: false,
		};
		rerenderApp();

		await waitFor(() => {
			expect(
				useChatStore.getState().sessions["machine-2-stale"],
			).toBeUndefined();
		});
	});

	it("does not overwrite replayed deltas with an old snapshot after abort", async () => {
		const lastGoodSessions = [
			{
				sessionId: "session-1",
				title: "Last good snapshot",
				backendId: "backend-1",
				backendLabel: "Claude",
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				machineId: "machine-1",
				cwd: "/repo",
				revision: 1,
				isAttached: true,
			},
		];
		sessionsState.sessionsQuery = {
			data: { sessions: lastGoodSessions },
			isError: false,
		};
		const { rerenderApp } = renderApp();
		await waitFor(() => {
			expect(useChatStore.getState().sessions["session-1"]?.title).toBe(
				"Last good snapshot",
			);
		});

		let generation = 0;
		act(() => {
			generation = useTeamStore.getState().beginSessionProjectionRecovery();
		});
		act(() => {
			handlers.sessionsChanged?.({
				machineId: "machine-1",
				added: [],
				updated: [{ ...lastGoodSessions[0], title: "Buffered after failure" }],
				removed: [],
			});
		});
		expect(useChatStore.getState().sessions["session-1"]?.title).toBe(
			"Last good snapshot",
		);

		act(() => {
			useTeamStore.getState().abortSessionProjectionRecovery(generation);
		});
		await waitFor(() => {
			expect(useChatStore.getState().sessions["session-1"]?.title).toBe(
				"Buffered after failure",
			);
		});

		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						...lastGoodSessions[0],
						title: "Late stale query after failure",
					},
				],
			},
			isError: false,
		};
		rerenderApp();
		await act(async () => {
			await Promise.resolve();
		});
		expect(useChatStore.getState().sessions["session-1"]?.title).toBe(
			"Buffered after failure",
		);
	});

	it("rejects a new stale query snapshot from an aborted recovery generation", async () => {
		const generation = useTeamStore.getState().beginSessionProjectionRecovery();
		const { rerenderApp } = renderApp();
		const staleSnapshot = {
			sessionId: "session-1",
			title: "Stale query after failure",
			backendId: "backend-1",
			backendLabel: "Claude",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-01T00:00:00Z",
			machineId: "machine-1",
			cwd: "/repo",
			revision: 1,
			isAttached: true,
		};
		sessionsState.sessionsQuery = {
			data: { sessions: [staleSnapshot] },
			isError: false,
		};
		rerenderApp();

		act(() => {
			handlers.sessionsChanged?.({
				machineId: "machine-1",
				added: [{ ...staleSnapshot, title: "Buffered after failure" }],
				updated: [],
				removed: [],
			});
		});
		expect(useChatStore.getState().sessions["session-1"]).toBeUndefined();

		act(() => {
			useTeamStore.getState().abortSessionProjectionRecovery(generation);
		});
		await waitFor(() => {
			expect(useChatStore.getState().sessions["session-1"]?.title).toBe(
				"Buffered after failure",
			);
		});
		expect(useChatStore.getState().sessions["session-1"]?.title).not.toBe(
			"Stale query after failure",
		);
	});

	it("restores the active session and replays backfill after refresh", async () => {
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						sessionId: "session-1",
						title: "Restored Session",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
						cwd: "/repo",
						revision: 2,
						isAttached: true,
					},
				],
			},
			isError: false,
		};
		useChatStore.setState({
			sessions: {
				"session-1": createStoredSession({
					title: "Restored Session",
					revision: 2,
				}),
			},
			activeSessionId: "session-1",
		});
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 2,
					events: [
						{
							sessionId: "session-1",
							machineId: "machine-1",
							revision: 2,
							seq: 1,
							kind: "agent_message_chunk",
							payload: {
								sessionId: "session-1",
								update: {
									sessionUpdate: "agent_message_chunk",
									content: { type: "text", text: "Recovered after refresh" },
								},
							},
						},
					],
					nextAfterSeq: 1,
					hasMore: false,
				}),
		});

		renderApp();

		await waitFor(() => {
			expect(screen.getByTestId("active-session-title")).toHaveTextContent(
				"Restored Session",
			);
		});
		await waitFor(() => {
			expect(screen.getByText("Recovered after refresh")).toBeInTheDocument();
		});
		expect(mockGatewaySocket.subscribeToSession).toHaveBeenCalledWith(
			"session-1",
		);
	});

	it("uses the server summary revision when refreshing a persisted attached session", async () => {
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						sessionId: "session-1",
						title: "Revision Sync Session",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
						cwd: "/repo",
						revision: 3,
						isAttached: true,
					},
				],
			},
			isError: false,
		};
		useChatStore.setState({
			sessions: {
				"session-1": createStoredSession({
					title: "Revision Sync Session",
					isAttached: false,
					revision: 1,
					lastAppliedSeq: 5,
				}),
			},
			activeSessionId: "session-1",
		});
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					sessionId: "session-1",
					machineId: "machine-1",
					revision: 3,
					events: [],
					nextAfterSeq: 0,
					hasMore: false,
				}),
		});

		renderApp();

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalled();
		});

		const firstRequestedUrl = String(mockFetch.mock.calls[0]?.[0] ?? "");
		expect(firstRequestedUrl).toContain("sessionId=session-1");
		expect(firstRequestedUrl).toContain("revision=3");
		expect(firstRequestedUrl).toContain("afterSeq=0");
	});

	it("buffers encrypted live events until the DEK becomes available", async () => {
		sessionsState.sessionsQuery = {
			data: {
				sessions: [
					{
						sessionId: "session-1",
						title: "Encrypted Session",
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
						cwd: "/repo",
						revision: 1,
						isAttached: false,
						wrappedDek: "wrapped-1",
					},
				],
			},
			isError: false,
		};
		useChatStore.setState({
			sessions: {
				"session-1": createStoredSession({
					title: "Encrypted Session",
					isAttached: false,
					revision: 1,
					wrappedDek: "wrapped-1",
				}),
			},
			activeSessionId: "session-1",
		});
		mockE2EE.hasSessionDek.mockReturnValue(false);
		mockE2EE.getSessionE2EEStatus.mockReturnValue("missing_key");
		decryptedPayloads.set("cipher-1", {
			sessionId: "session-1",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Secret restored after pairing" },
			},
		});

		renderApp();

		await waitFor(() => {
			expect(screen.getByTestId("active-session-title")).toHaveTextContent(
				"Encrypted Session",
			);
		});

		await act(async () => {
			handlers.sessionEvent?.({
				sessionId: "session-1",
				machineId: "machine-1",
				revision: 1,
				seq: 1,
				kind: "agent_message_chunk",
				payload: {
					t: "encrypted",
					c: "cipher-1",
				},
			});
		});

		expect(
			screen.queryByText("Secret restored after pairing"),
		).not.toBeInTheDocument();

		mockE2EE.hasSessionDek.mockReturnValue(true);
		await act(async () => {
			emitDekReady("session-1");
		});

		await waitFor(() => {
			expect(
				screen.getByText("Secret restored after pairing"),
			).toBeInTheDocument();
		});
	});
});
