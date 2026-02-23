import { render, waitFor } from "@testing-library/react";
import type React from "react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/ui-config";

const ThemeSetter = ({ theme }: { theme: "light" | "dark" | "system" }) => {
	const { setTheme } = useTheme();

	useEffect(() => {
		setTheme(theme);
	}, [setTheme, theme]);

	return null;
};

const mockChatStore = vi.hoisted(() => ({
	value: {
		sessions: {},
		activeSessionId: undefined,
		appError: undefined,
		setActiveSessionId: vi.fn(),
		setAppError: vi.fn(),
		createLocalSession: vi.fn(),
		syncSessions: vi.fn(),
		removeSession: vi.fn(),
		renameSession: vi.fn(),
		setInput: vi.fn(),
		setInputContents: vi.fn(),
		setSending: vi.fn(),
		setCanceling: vi.fn(),
		setError: vi.fn(),
		setStreamError: vi.fn(),
		updateSessionMeta: vi.fn(),
		addUserMessage: vi.fn(),
		addStatusMessage: vi.fn(),
		appendAssistantChunk: vi.fn(),
		appendThoughtChunk: vi.fn(),
		appendUserChunk: vi.fn(),
		addPermissionRequest: vi.fn(),
		setPermissionDecisionState: vi.fn(),
		setPermissionOutcome: vi.fn(),
		addToolCall: vi.fn(),
		updateToolCall: vi.fn(),
		appendTerminalOutput: vi.fn(),
		finalizeAssistantMessage: vi.fn(),
		handleSessionsChanged: vi.fn(),
		setSessionE2EEStatus: vi.fn(),
	},
}));

vi.mock("@/lib/chat-store", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/chat-store")>();
	const hook = () => mockChatStore.value;
	hook.getState = () => mockChatStore.value;
	return {
		...original,
		useChatStore: hook,
	};
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...original,
		useQueryClient: () => ({
			invalidateQueries: vi.fn(),
		}),
	};
});

vi.mock("@/hooks/useSessionQueries", () => ({
	useSessionQueries: () => ({
		sessionsQuery: {
			data: { sessions: [] },
			isError: false,
		},
		backendsQuery: {
			data: undefined,
			isError: false,
		},
		availableBackends: [],
		discoverSessionsMutation: {
			mutate: vi.fn(),
			mutateAsync: vi.fn(),
			isPending: false,
		},
	}),
	useDiscoverSessionsMutation: () => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
		variables: null,
	}),
}));

vi.mock("@/hooks/useSessionMutations", () => ({
	useSessionMutations: () => ({
		createSessionMutation: { isPending: false, mutateAsync: vi.fn() },
		renameSessionMutation: { mutate: vi.fn() },
		archiveSessionMutation: { mutateAsync: vi.fn() },
		cancelSessionMutation: { mutate: vi.fn() },
		setSessionModeMutation: { mutate: vi.fn(), isPending: false },
		setSessionModelMutation: { mutate: vi.fn(), isPending: false },
		sendMessageMutation: { mutate: vi.fn() },
		permissionDecisionMutation: { mutate: vi.fn() },
		loadSessionMutation: { isPending: false, mutateAsync: vi.fn() },
		reloadSessionMutation: { isPending: false, mutateAsync: vi.fn() },
	}),
}));

vi.mock("@/hooks/useSessionEventSources", () => ({
	useSessionEventSources: vi.fn(),
}));

vi.mock("@/hooks/useMachinesQuery", () => ({
	useMachinesQuery: () => ({
		data: { machines: [] },
		isError: false,
	}),
}));

vi.mock("@/hooks/useSessionList", () => ({
	useSessionList: () => ({
		workspaceList: [],
		activeSession: undefined,
		selectedWorkspaceCwd: undefined,
		effectiveWorkspaceCwd: undefined,
		sessionList: [],
	}),
}));

vi.mock("@/hooks/useMachineDiscovery", () => ({
	useMachineDiscovery: () => undefined,
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
		handleOpenCreateDialog: vi.fn(),
		handleCreateSession: vi.fn(),
		handleRenameSubmit: vi.fn(),
		handleArchiveSession: vi.fn(),
		handlePermissionDecision: vi.fn(),
		handleModeChange: vi.fn(),
		handleModelChange: vi.fn(),
		handleCancel: vi.fn(),
		handleForceReload: vi.fn(),
		handleSyncHistory: vi.fn(),
		handleSend: vi.fn(),
	}),
}));

vi.mock("@/components/app/AppHeader", () => ({
	AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("@/components/app/ChatMessageList", () => ({
	ChatMessageList: () => <div data-testid="chat-messages" />,
}));

vi.mock("@/components/app/ChatFooter", () => ({
	ChatFooter: () => <div data-testid="chat-footer" />,
}));

vi.mock("@/components/app/AppSidebar", () => ({
	AppSidebar: () => <button type="button">sidebar</button>,
}));

vi.mock("@/components/machines/MachinesSidebar", () => ({
	MachinesSidebar: () => <div data-testid="machines-sidebar" />,
}));

vi.mock("@/components/ui/toaster", () => ({
	Toaster: () => null,
}));

vi.mock("@/components/app/CreateSessionDialog", () => ({
	CreateSessionDialog: () => null,
}));

vi.mock("@/components/app/FileExplorerDialog", () => ({
	FileExplorerDialog: () => null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
	useAuth: () => ({
		isAuthenticated: false,
		isLoading: false,
		isAuthEnabled: false,
		user: null,
		login: vi.fn(),
		logout: vi.fn(),
		refresh: vi.fn(),
	}),
	AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const setMatchMedia = (matches: boolean) => {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const mediaQueryList = {
		matches,
		media: "(prefers-color-scheme: dark)",
		addEventListener: (
			_: string,
			listener: (event: MediaQueryListEvent) => void,
		) => {
			listeners.add(listener);
		},
		removeEventListener: (
			_: string,
			listener: (event: MediaQueryListEvent) => void,
		) => {
			listeners.delete(listener);
		},
		dispatch: (nextMatches: boolean) => {
			mediaQueryList.matches = nextMatches;
			listeners.forEach((listener) =>
				listener({ matches: nextMatches } as MediaQueryListEvent),
			);
		},
	};

	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn(() => mediaQueryList),
	});
	return mediaQueryList;
};

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove("dark");
});

describe("App theme preference", () => {
	it("uses stored preference and updates root class", async () => {
		localStorage.setItem(THEME_STORAGE_KEY, "dark");
		setMatchMedia(false);

		const { default: App } = await import("../App");
		render(
			<MemoryRouter>
				<App />
			</MemoryRouter>,
		);

		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("responds to system theme changes when in system mode", async () => {
		const mediaQueryList = setMatchMedia(false);

		const { default: App } = await import("../App");
		render(
			<MemoryRouter>
				<App />
			</MemoryRouter>,
		);

		expect(document.documentElement.classList.contains("dark")).toBe(false);

		mediaQueryList.dispatch(true);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("updates preference when theme changes", async () => {
		setMatchMedia(true);

		render(
			<ThemeProvider>
				<ThemeSetter theme="light" />
			</ThemeProvider>,
		);

		await waitFor(() => {
			expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
			expect(document.documentElement.classList.contains("dark")).toBe(false);
		});
	});
});
