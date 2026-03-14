import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@/lib/chat-store";
import { ChatMessageList } from "../ChatMessageList";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"session.syncingHistory": "Synchronizing history…",
				"chat.welcomeCreateSession": "Create a session to start chatting.",
				"chat.welcomeSelectMachine":
					"Select a machine from the sidebar to get started.",
				"chat.createSession": "Create Session",
				"common.appName": "Mobvibe",
			};
			return translations[key] ?? key;
		},
	}),
}));

vi.mock("@tanstack/react-virtual", () => ({
	useVirtualizer: () => ({
		getVirtualItems: () => [],
		getTotalSize: () => 0,
		measureElement: vi.fn(),
		scrollToIndex: vi.fn(),
	}),
}));

vi.mock("@/lib/ui-store", () => ({
	useUiStore: () => ({
		setFileExplorerOpen: vi.fn(),
		setFilePreviewPath: vi.fn(),
	}),
}));

vi.mock("@/components/app/E2EEMissingBanner", () => ({
	E2EEMissingBanner: () => <div data-testid="e2ee-banner" />,
}));

vi.mock("@/components/brand-logo", () => ({
	BrandLogo: () => <div data-testid="brand-logo" />,
}));

vi.mock("@/components/chat/MessageItem", () => ({
	MessageItem: () => <div data-testid="message-item" />,
}));

vi.mock("@/components/chat/ThinkingIndicator", () => ({
	ThinkingIndicator: () => <div data-testid="thinking-indicator" />,
}));

vi.mock("@/components/chat/tool-call-group", () => ({
	ToolCallGroup: () => <div data-testid="tool-call-group" />,
}));

const buildSession = (overrides: Partial<ChatSession> = {}): ChatSession =>
	({
		sessionId: "session-1",
		title: "Session 1",
		input: "",
		inputContents: [],
		messages: [],
		terminalOutputs: {},
		sending: false,
		canceling: false,
		isLoading: false,
		historySyncing: false,
		...overrides,
	}) as ChatSession;

describe("ChatMessageList", () => {
	it("shows a visible sync placeholder while transcript history is being restored", () => {
		render(
			<ChatMessageList
				activeSession={buildSession({ historySyncing: true })}
				loadingMessage="Synchronizing history…"
				hasMachineSelected
				onCreateSession={vi.fn()}
				onPermissionDecision={vi.fn()}
			/>,
		);

		expect(screen.getByText("Synchronizing history…")).toBeInTheDocument();
		expect(screen.queryByTestId("brand-logo")).not.toBeInTheDocument();
	});

	it("falls back to the empty session logo only when the session is idle", () => {
		render(
			<ChatMessageList
				activeSession={buildSession()}
				hasMachineSelected
				onCreateSession={vi.fn()}
				onPermissionDecision={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("brand-logo")).toBeInTheDocument();
		expect(
			screen.queryByText("Synchronizing history…"),
		).not.toBeInTheDocument();
	});
});
