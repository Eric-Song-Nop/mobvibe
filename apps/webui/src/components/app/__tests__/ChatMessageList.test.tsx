import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@/lib/chat-store";
import { ChatMessageList } from "../ChatMessageList";

type CapturedVirtualizerOptions = {
	anchorTo?: string;
	directDomUpdates?: boolean;
	followOnAppend?: boolean;
	getItemKey: (index: number) => string | number;
	scrollEndThreshold?: number;
};

const virtualizerMock = vi.hoisted(() => ({
	containerRef: vi.fn(),
	isAtEnd: vi.fn(() => true),
	options: undefined as CapturedVirtualizerOptions | undefined,
	scrollToEnd: vi.fn(),
	scrollToIndex: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"session.syncingHistory": "Synchronizing history…",
				"chat.welcomeCreateSession": "Create a session to start chatting.",
				"chat.welcomeSelectMachine":
					"Select a machine from the sidebar to get started.",
				"chat.createSession": "Create Session",
				"chat.jumpToLatest": "Jump to Latest",
				"chat.messageHistory": "Conversation messages",
				"common.appName": "Mobvibe",
			};
			return translations[key] ?? key;
		},
	}),
}));

vi.mock("@tanstack/react-virtual", () => ({
	useVirtualizer: (options: CapturedVirtualizerOptions) => {
		virtualizerMock.options = options;
		return {
			containerRef: virtualizerMock.containerRef,
			getVirtualItems: () => [],
			getTotalSize: () => 0,
			isAtEnd: virtualizerMock.isAtEnd,
			measureElement: vi.fn(),
			scrollToEnd: virtualizerMock.scrollToEnd,
			scrollToIndex: virtualizerMock.scrollToIndex,
		};
	},
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

vi.mock("@mobvibe/ui/brand-logo", () => ({
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

type TextMessage = Extract<ChatMessage, { kind: "text" }>;

const buildTextMessage = (id: string): TextMessage => ({
	id,
	role: "assistant",
	kind: "text",
	content: id,
	contentBlocks: [],
	createdAt: "2026-07-27T00:00:00.000Z",
	isStreaming: false,
});

const buildToolCallMessage = (id: string): ChatMessage => ({
	id,
	role: "assistant",
	kind: "tool_call",
	sessionId: "session-1",
	toolCallId: id,
	createdAt: "2026-07-27T00:00:00.000Z",
	isStreaming: false,
});

describe("ChatMessageList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		virtualizerMock.options = undefined;
		virtualizerMock.isAtEnd.mockReturnValue(true);
	});

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

	it("configures end anchoring with stable session-scoped message keys", () => {
		render(
			<ChatMessageList
				activeSession={buildSession({
					messages: [buildTextMessage("message-1")],
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);

		expect(virtualizerMock.options).toMatchObject({
			anchorTo: "end",
			directDomUpdates: true,
			followOnAppend: true,
			scrollEndThreshold: 64,
		});
		expect(virtualizerMock.options?.getItemKey(0)).toBe("session-1:message-1");
	});

	it("scrolls to the end on first content and session changes, not same-session appends", () => {
		const { rerender } = render(
			<ChatMessageList
				activeSession={buildSession({
					messages: [buildTextMessage("message-1")],
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);

		expect(virtualizerMock.scrollToEnd).toHaveBeenCalledTimes(1);

		rerender(
			<ChatMessageList
				activeSession={buildSession({
					messages: [
						buildTextMessage("message-1"),
						buildTextMessage("message-2"),
					],
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);
		expect(virtualizerMock.scrollToEnd).toHaveBeenCalledTimes(1);

		rerender(
			<ChatMessageList
				activeSession={buildSession({
					sessionId: "session-2",
					messages: [buildTextMessage("message-1")],
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);
		expect(virtualizerMock.scrollToEnd).toHaveBeenCalledTimes(2);
	});

	it("keeps grouped tool-call keys stable when history is prepended", () => {
		const toolMessages = [
			buildToolCallMessage("tool-1"),
			buildToolCallMessage("tool-2"),
		];
		const { rerender } = render(
			<ChatMessageList
				activeSession={buildSession({ messages: toolMessages })}
				onPermissionDecision={vi.fn()}
			/>,
		);
		const keyBeforePrepend = virtualizerMock.options?.getItemKey(0);

		rerender(
			<ChatMessageList
				activeSession={buildSession({
					messages: [buildTextMessage("older-message"), ...toolMessages],
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);

		expect(keyBeforePrepend).toBe("session-1:tool-1");
		expect(virtualizerMock.options?.getItemKey(1)).toBe(keyBeforePrepend);
	});

	it("changes the trailing indicator key only when a real message is appended", () => {
		const firstMessage = buildTextMessage("message-1");
		const { rerender } = render(
			<ChatMessageList
				activeSession={buildSession({
					messages: [firstMessage],
					sending: true,
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);
		const initialIndicatorKey = virtualizerMock.options?.getItemKey(1);

		rerender(
			<ChatMessageList
				activeSession={buildSession({
					messages: [{ ...firstMessage, content: "streamed content" }],
					sending: true,
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);
		expect(virtualizerMock.options?.getItemKey(1)).toBe(initialIndicatorKey);

		expect(initialIndicatorKey).toBe(
			"session-1:__thinking-indicator__:message-1",
		);

		rerender(
			<ChatMessageList
				activeSession={buildSession({
					messages: [firstMessage, buildTextMessage("message-2")],
					sending: true,
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);
		expect(virtualizerMock.options?.getItemKey(2)).toBe(
			"session-1:__thinking-indicator__:message-2",
		);
	});

	it("offers a jump-to-latest action while reading history", () => {
		virtualizerMock.isAtEnd.mockReturnValue(false);
		render(
			<ChatMessageList
				activeSession={buildSession({
					messages: [buildTextMessage("message-1")],
				})}
				onPermissionDecision={vi.fn()}
			/>,
		);
		virtualizerMock.scrollToEnd.mockClear();

		fireEvent.click(
			screen.getByRole("button", {
				name: "Jump to Latest",
			}),
		);

		expect(
			screen.getByRole("region", {
				name: "Conversation messages",
			}),
		).toHaveFocus();
		expect(virtualizerMock.isAtEnd).toHaveBeenCalledWith(64);
		expect(virtualizerMock.scrollToEnd).toHaveBeenCalledOnce();
	});
});
