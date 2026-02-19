import "@testing-library/jest-dom/vitest";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSession } from "@/lib/chat-store";
import { useChatStore } from "@/lib/chat-store";
import { MessageItem } from "../src/components/chat/MessageItem";
import i18n from "../src/i18n";
import { createDefaultContentBlocks } from "../src/lib/content-block-utils";

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => {
	const base: ChatMessage = {
		id: "message-1",
		role: "assistant",
		kind: "text",
		content: "hello",
		contentBlocks: createDefaultContentBlocks("hello"),
		createdAt: new Date().toISOString(),
		isStreaming: false,
	};
	return { ...base, ...overrides } as ChatMessage;
};

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
	sessionId: "session-1",
	title: "Test session",
	input: "",
	inputContents: createDefaultContentBlocks(""),
	messages: [],
	terminalOutputs: {},
	streamingMessageId: undefined,
	sending: false,
	canceling: false,
	...overrides,
});

const resetStore = () => {
	useChatStore.persist.clearStorage();
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
		appError: undefined,
	});
};

describe("MessageItem", () => {
	beforeEach(() => {
		resetStore();
	});

	it("renders user messages on the right", () => {
		const message = buildMessage({ role: "user", content: "Hello" });
		const { container } = render(<MessageItem message={message} />);
		expect(container.firstChild).toHaveClass("items-end");
	});

	it("renders assistant content with streaming opacity", () => {
		const message = buildMessage({
			isStreaming: true,
			content: "Streaming",
			contentBlocks: createDefaultContentBlocks("Streaming"),
		});
		const { container, getByText } = render(<MessageItem message={message} />);
		expect(getByText("Streaming")).toBeInTheDocument();
		expect(container.querySelector(".opacity-90")).toBeTruthy();
	});

	it("renders tool call text output as plain text", () => {
		const message = {
			...buildMessage({
				kind: "tool_call",
				sessionId: "session-1",
				toolCallId: "tool-1",
			}),
			content: [
				{
					type: "content",
					content: "first line\nsecond line",
				},
			],
		} as ChatMessage;
		const { container, getByText } = render(<MessageItem message={message} />);
		// Open the "Details" accordion to reveal output
		const detailsSummary = getByText(i18n.t("toolCall.details"));
		expect(detailsSummary).toBeTruthy();
		const details = detailsSummary.closest("details");
		expect(details).toBeTruthy();
		if (details) {
			details.open = true;
		}
		const output = container.querySelector(
			"pre.whitespace-pre-wrap.break-words",
		);
		expect(output).toBeTruthy();
		if (!output) {
			return;
		}
		expect(output.textContent).toBe("first line\nsecond line");
	});

	it("renders tool call content types", () => {
		const message = {
			...buildMessage({
				kind: "tool_call",
				sessionId: "session-1",
				toolCallId: "tool-2",
			}),
			content: [
				{
					type: "content",
					content: {
						type: "image",
						data: "dGVzdA==",
						mimeType: "image/png",
					},
				},
				{
					type: "content",
					content: {
						type: "audio",
						data: "dGVzdA==",
						mimeType: "audio/wav",
					},
				},
				{
					type: "content",
					content: {
						type: "resource",
						resource: {
							uri: "file:///tmp/test.txt",
							text: "resource text",
						},
					},
				},
				{
					type: "content",
					content: {
						type: "resource_link",
						uri: "https://example.com/resource",
						name: "resource",
						mimeType: "text/plain",
						size: 2048,
					},
				},
				{
					type: "diff",
					path: "/tmp/demo.txt",
					oldText: "old",
					newText: "new",
				},
				{
					type: "terminal",
					terminalId: "terminal-1",
				},
			],
		} as ChatMessage;
		const terminalSession = buildSession({
			terminalOutputs: {
				"terminal-1": {
					terminalId: "terminal-1",
					output: "terminal output",
					truncated: false,
				},
			},
		});
		useChatStore.setState({
			sessions: { "session-1": terminalSession },
			activeSessionId: "session-1",
			appError: undefined,
		});
		const { getAllByText, getByText, getByRole } = render(
			<MessageItem message={message} />,
		);
		// Open the "Details" accordion to reveal content
		const detailsSummary = getByText(i18n.t("toolCall.details"));
		expect(detailsSummary).toBeTruthy();
		const details = detailsSummary.closest("details");
		expect(details).toBeTruthy();
		if (details) {
			details.open = true;
		}
		expect(getAllByText(i18n.t("toolCall.image")).length).toBeGreaterThan(0);
		expect(getAllByText(i18n.t("toolCall.audio")).length).toBeGreaterThan(0);
		expect(getAllByText(i18n.t("toolCall.resource")).length).toBeGreaterThan(0);
		expect(
			getAllByText(i18n.t("toolCall.resourceLink")).length,
		).toBeGreaterThan(0);
		expect(getAllByText(i18n.t("toolCall.changes")).length).toBeGreaterThan(0);
		expect(getByText("terminal output")).toBeInTheDocument();
		const link = getByRole("link", { name: "resource" });
		expect(link).toHaveAttribute("href", "https://example.com/resource");
	});

	it("renders tool call path from rawInput.path", () => {
		const onOpenFilePreview = vi.fn();
		const message = {
			...buildMessage({
				kind: "tool_call",
				sessionId: "session-1",
				toolCallId: "tool-3",
			}),
			content: [],
			rawInput: {
				path: "/tmp/foo.txt",
			},
		} as ChatMessage;
		const { getByRole } = render(
			<MessageItem message={message} onOpenFilePreview={onOpenFilePreview} />,
		);
		const button = getByRole("button", { name: "foo.txt" });
		fireEvent.click(button);
		expect(onOpenFilePreview).toHaveBeenCalledWith("/tmp/foo.txt");
	});

	it("renders tool call paths from rawInput.patch", () => {
		const onOpenFilePreview = vi.fn();
		const message = {
			...buildMessage({
				kind: "tool_call",
				sessionId: "session-1",
				toolCallId: "tool-4",
			}),
			content: [],
			rawInput: {
				patch: [
					"*** Begin Patch",
					"*** Update File: /tmp/alpha.txt",
					"*** Add File: /tmp/bravo.txt",
					"*** Delete File: /tmp/charlie.txt",
					"*** End Patch",
				].join("\n"),
			},
		} as ChatMessage;
		const { getByRole } = render(
			<MessageItem message={message} onOpenFilePreview={onOpenFilePreview} />,
		);
		fireEvent.click(getByRole("button", { name: "alpha.txt" }));
		fireEvent.click(getByRole("button", { name: "bravo.txt" }));
		fireEvent.click(getByRole("button", { name: "charlie.txt" }));
		expect(onOpenFilePreview).toHaveBeenCalledWith("/tmp/alpha.txt");
		expect(onOpenFilePreview).toHaveBeenCalledWith("/tmp/bravo.txt");
		expect(onOpenFilePreview).toHaveBeenCalledWith("/tmp/charlie.txt");
	});
});
