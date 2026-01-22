import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
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
		addPermissionRequest: vi.fn(),
		setPermissionDecisionState: vi.fn(),
		setPermissionOutcome: vi.fn(),
		addToolCall: vi.fn(),
		updateToolCall: vi.fn(),
		appendTerminalOutput: vi.fn(),
		finalizeAssistantMessage: vi.fn(),
	},
}));

vi.mock("@/lib/chat-store", () => ({
	useChatStore: () => mockChatStore.value,
}));

vi.mock("@/hooks/useMessageAutoScroll", () => ({
	useMessageAutoScroll: () => ({
		messageListRef: { current: null },
		endOfMessagesRef: { current: null },
		handleMessagesScroll: vi.fn(),
	}),
}));

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
		defaultBackendId: undefined,
	}),
}));

vi.mock("@/hooks/useSessionMutations", () => ({
	useSessionMutations: () => ({
		createSessionMutation: { isPending: false, mutateAsync: vi.fn() },
		renameSessionMutation: { mutate: vi.fn() },
		closeSessionMutation: { mutateAsync: vi.fn() },
		cancelSessionMutation: { mutate: vi.fn() },
		setSessionModeMutation: { mutate: vi.fn(), isPending: false },
		setSessionModelMutation: { mutate: vi.fn(), isPending: false },
		sendMessageMutation: { mutate: vi.fn() },
		createMessageIdMutation: { mutateAsync: vi.fn() },
		permissionDecisionMutation: { mutate: vi.fn() },
	}),
}));

vi.mock("@/hooks/useSessionEventSources", () => ({
	useSessionEventSources: vi.fn(),
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

vi.mock("@/components/ui/toaster", () => ({
	Toaster: () => null,
}));

vi.mock("@/components/app/CreateSessionDialog", () => ({
	CreateSessionDialog: () => null,
}));

vi.mock("@/components/app/FileExplorerDialog", () => ({
	FileExplorerDialog: () => null,
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
		render(<App />);

		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("responds to system theme changes when in system mode", async () => {
		const mediaQueryList = setMatchMedia(false);

		const { default: App } = await import("../App");
		render(<App />);

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
