import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { useChatStore } from "@/lib/chat-store";
import { useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const sessionsState = vi.hoisted(() => ({
	sessionsQuery: {
		data: { sessions: [] as Array<Record<string, unknown>> },
		isError: false,
	},
	backendsQuery: {
		data: { backends: [{ backendId: "backend-1", backendLabel: "Claude" }] },
		isError: false,
	},
}));

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
		renameSessionMutation: { mutate: vi.fn() },
		archiveSessionMutation: { mutateAsync: vi.fn() },
		closeSessionMutation: { mutateAsync: vi.fn(), isPending: false },
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
		handleCloseSession: vi.fn(),
		handleBulkArchiveSessions: vi.fn(),
		handlePermissionDecision: vi.fn(),
		handleModeChange: vi.fn(),
		handleModelChange: vi.fn(),
		handleSessionConfigOptionChange: vi.fn(),
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

	return render(
		<MemoryRouter initialEntries={["/"]}>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</MemoryRouter>,
	);
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
		useUiStore.setState({
			selectedWorkspaceByMachine: {},
			createDialogOpen: false,
			fileExplorerOpen: false,
			filePreviewPath: undefined,
			commandPaletteOpen: false,
			chatSearchOpen: false,
		});
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
