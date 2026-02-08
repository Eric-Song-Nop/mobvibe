import "@testing-library/jest-dom/vitest";
import type { ChatMessage, ChatSession } from "@mobvibe/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "../src/components/app/ChatMessageList";
import i18n from "../src/i18n";
import { createDefaultContentBlocks } from "../src/lib/content-block-utils";

vi.mock("../src/components/chat/MessageItem", () => ({
	MessageItem: ({ message }: { message: ChatMessage }) => (
		<div data-testid={`message-${message.id}`}>{message.content as string}</div>
	),
}));

/**
 * The virtualizer uses element.offsetWidth / offsetHeight (not
 * getBoundingClientRect) to determine both the scroll container viewport
 * size and to measure virtual items.  In jsdom these are always 0 because
 * there is no layout engine.
 *
 * We override the HTMLElement.prototype getter so that:
 * - elements with data-index (virtual items) report ITEM_HEIGHT matching
 *   estimateSize, preventing a measurement-update loop.
 * - all other elements (including the scroll container) report the viewport
 *   dimensions so the virtualizer sees a non-zero visible range.
 */
const VIEWPORT_HEIGHT = 600;
const VIEWPORT_WIDTH = 800;
const ITEM_HEIGHT = 112;

let origOffsetHeight: PropertyDescriptor | undefined;
let origOffsetWidth: PropertyDescriptor | undefined;

beforeEach(() => {
	origOffsetHeight = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"offsetHeight",
	);
	origOffsetWidth = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"offsetWidth",
	);

	Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
		configurable: true,
		get(this: HTMLElement) {
			return this.hasAttribute("data-index") ? ITEM_HEIGHT : VIEWPORT_HEIGHT;
		},
	});
	Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
		configurable: true,
		get(this: HTMLElement) {
			return VIEWPORT_WIDTH;
		},
	});
});

afterEach(() => {
	// Clean up React tree BEFORE restoring offset mocks.  The virtualizer's
	// scrollToIndex schedules requestAnimationFrame callbacks that reference
	// targetWindow.  Cleaning up first lets the virtualizer's cleanup() run
	// (which sets targetWindow = null) while the RAF is still valid.
	// We then cancel all pending animation frames to prevent the stale
	// callback from firing after the window reference is gone.
	cleanup();

	// Cancel any pending animation frames left by the virtualizer
	const win = globalThis.window;
	if (win) {
		let id = win.requestAnimationFrame(() => {});
		while (id > 0) {
			win.cancelAnimationFrame(id);
			id -= 1;
		}
	}

	if (origOffsetHeight) {
		Object.defineProperty(
			HTMLElement.prototype,
			"offsetHeight",
			origOffsetHeight,
		);
	}
	if (origOffsetWidth) {
		Object.defineProperty(
			HTMLElement.prototype,
			"offsetWidth",
			origOffsetWidth,
		);
	}
	vi.restoreAllMocks();
});

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => {
	const base: ChatMessage = {
		id: "msg-1",
		role: "assistant",
		kind: "text",
		content: "hello",
		contentBlocks: createDefaultContentBlocks("hello"),
		createdAt: new Date().toISOString(),
		isStreaming: false,
	};
	return { ...base, ...overrides } as ChatMessage;
};

const buildSession = (overrides?: Partial<ChatSession>): ChatSession =>
	({
		sessionId: "session-1",
		title: "Test session",
		input: "",
		inputContents: createDefaultContentBlocks(""),
		messages: [],
		terminalOutputs: {},
		streamingMessageId: undefined,
		sending: false,
		canceling: false,
		isLoading: false,
		...overrides,
	}) as ChatSession;

const noop = () => {};

describe("ChatMessageList", () => {
	it("shows welcome message when no active session and no machine selected", () => {
		render(<ChatMessageList onPermissionDecision={noop} />);
		expect(
			screen.getByText(i18n.t("chat.welcomeSelectMachine")),
		).toBeInTheDocument();
	});

	it("shows create session button when machine is selected but no session", () => {
		const handleCreate = vi.fn();
		render(
			<ChatMessageList
				hasMachineSelected
				onCreateSession={handleCreate}
				onPermissionDecision={noop}
			/>,
		);
		expect(
			screen.getByText(i18n.t("chat.welcomeCreateSession")),
		).toBeInTheDocument();
		const button = screen.getByRole("button", {
			name: i18n.t("chat.createSession"),
		});
		expect(button).toBeInTheDocument();
		button.click();
		expect(handleCreate).toHaveBeenCalledOnce();
	});

	it("does not show create button when no machine is selected", () => {
		render(<ChatMessageList onPermissionDecision={noop} />);
		expect(
			screen.queryByRole("button", { name: i18n.t("chat.createSession") }),
		).not.toBeInTheDocument();
	});

	it("does not show create button when onCreateSession is not provided", () => {
		render(<ChatMessageList hasMachineSelected onPermissionDecision={noop} />);
		expect(
			screen.getByText(i18n.t("chat.welcomeCreateSession")),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: i18n.t("chat.createSession") }),
		).not.toBeInTheDocument();
	});

	it("does not show welcome states when activeSession is present", () => {
		const session = buildSession({ messages: [] });
		render(
			<ChatMessageList
				activeSession={session}
				hasMachineSelected
				onCreateSession={vi.fn()}
				onPermissionDecision={noop}
			/>,
		);
		expect(
			screen.queryByText(i18n.t("chat.welcomeSelectMachine")),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(i18n.t("chat.welcomeCreateSession")),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: i18n.t("chat.createSession") }),
		).not.toBeInTheDocument();
	});

	it("shows loading message when session is loading", () => {
		const session = buildSession({ isLoading: true });
		render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		expect(screen.getByText(i18n.t("common.loading"))).toBeInTheDocument();
	});

	it("shows custom loading message when provided", () => {
		const session = buildSession({ isLoading: true });
		render(
			<ChatMessageList
				activeSession={session}
				loadingMessage="Connecting..."
				onPermissionDecision={noop}
			/>,
		);
		expect(screen.getByText("Connecting...")).toBeInTheDocument();
	});

	it("shows start banner when session has no messages", () => {
		const session = buildSession({ messages: [] });
		const { container } = render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		const banner = container.querySelector(".whitespace-pre.font-mono");
		expect(banner).toBeTruthy();
		expect(banner?.textContent).toContain("██");
	});

	it("renders messages via virtualizer", async () => {
		const messages = [
			buildMessage({ id: "msg-1", content: "first" }),
			buildMessage({ id: "msg-2", content: "second" }),
			buildMessage({ id: "msg-3", content: "third" }),
		];
		const session = buildSession({ messages });
		render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		// The virtualizer's _didMount fires in useEffect (async), so virtual
		// items appear after a subsequent re-render triggered by scrollRect update.
		expect(await screen.findByTestId("message-msg-1")).toBeInTheDocument();
		expect(screen.getByTestId("message-msg-2")).toBeInTheDocument();
		expect(screen.getByTestId("message-msg-3")).toBeInTheDocument();
	});

	it("positions virtual items absolutely with translateY", async () => {
		const messages = [
			buildMessage({ id: "msg-1", content: "first" }),
			buildMessage({ id: "msg-2", content: "second" }),
		];
		const session = buildSession({ messages });
		const { container } = render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		await screen.findByTestId("message-msg-1");
		const positioned = container.querySelectorAll("[style*='translateY']");
		expect(positioned.length).toBeGreaterThanOrEqual(2);
	});

	it("sets the virtualizer container height based on estimated sizes", () => {
		const messages = [
			buildMessage({ id: "msg-1", content: "hello" }),
			buildMessage({ id: "msg-2", content: "world" }),
		];
		const session = buildSession({ messages });
		const { container } = render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		const sizeContainer = container.querySelector(
			".relative[style]",
		) as HTMLElement;
		expect(sizeContainer).toBeTruthy();
		expect(sizeContainer.style.height).toBe("224px");
	});

	it("attaches data-index to virtual items for measurement", async () => {
		const messages = [
			buildMessage({ id: "msg-1", content: "first" }),
			buildMessage({ id: "msg-2", content: "second" }),
		];
		const session = buildSession({ messages });
		const { container } = render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		await screen.findByTestId("message-msg-1");
		const item0 = container.querySelector("[data-index='0']");
		const item1 = container.querySelector("[data-index='1']");
		expect(item0).toBeTruthy();
		expect(item1).toBeTruthy();
	});

	it("does not show empty states when messages are present", async () => {
		const messages = [buildMessage({ id: "msg-1", content: "hello" })];
		const session = buildSession({ messages });
		render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		await screen.findByTestId("message-msg-1");
		expect(
			screen.queryByText(i18n.t("chat.selectSession")),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(i18n.t("common.loading")),
		).not.toBeInTheDocument();
	});

	it("uses message id as virtualizer item key", async () => {
		const messages = [
			buildMessage({ id: "custom-id-1", content: "first" }),
			buildMessage({ id: "custom-id-2", content: "second" }),
		];
		const session = buildSession({ messages });
		render(
			<ChatMessageList activeSession={session} onPermissionDecision={noop} />,
		);
		expect(
			await screen.findByTestId("message-custom-id-1"),
		).toBeInTheDocument();
		expect(screen.getByTestId("message-custom-id-2")).toBeInTheDocument();
	});
});
