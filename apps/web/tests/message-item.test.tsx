import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MessageItem } from "../src/components/chat/MessageItem";
import type { ChatMessage, ChatSession } from "../src/lib/chat-store";
import { useChatStore } from "../src/lib/chat-store";

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => {
	const base: ChatMessage = {
		id: "message-1",
		role: "assistant",
		kind: "text",
		content: "hello",
		createdAt: new Date().toISOString(),
		isStreaming: false,
	};
	return { ...base, ...overrides } as ChatMessage;
};

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
	sessionId: "session-1",
	title: "测试会话",
	input: "",
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
		const message = buildMessage({ role: "user", content: "你好" });
		const { container } = render(<MessageItem message={message} />);
		expect(container.firstChild).toHaveClass("items-end");
	});

	it("renders assistant content with streaming opacity", () => {
		const message = buildMessage({ isStreaming: true, content: "流式" });
		const { container, getByText } = render(<MessageItem message={message} />);
		expect(getByText("流式")).toBeInTheDocument();
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
		const { container, getAllByText, getByText } = render(
			<MessageItem message={message} />,
		);
		const details = getAllByText("工具调用")[0]?.closest("details");
		expect(details).toBeTruthy();
		if (details) {
			details.open = true;
		}
		const outputDetails = getByText("输出").closest("details");
		expect(outputDetails).toBeTruthy();
		if (outputDetails) {
			outputDetails.open = true;
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
		const details = getAllByText("工具调用")[0]?.closest("details");
		expect(details).toBeTruthy();
		if (details) {
			details.open = true;
		}
		const outputDetails = getByText("输出").closest("details");
		expect(outputDetails).toBeTruthy();
		if (outputDetails) {
			outputDetails.open = true;
		}
		expect(getByText("图片")).toBeInTheDocument();
		expect(getByText("音频")).toBeInTheDocument();
		expect(getByText("资源")).toBeInTheDocument();
		expect(getByText("资源链接")).toBeInTheDocument();
		expect(getByText("差异")).toBeInTheDocument();
		expect(getByText("原始")).toBeInTheDocument();
		expect(getByText("更新")).toBeInTheDocument();
		expect(getByText("terminal output")).toBeInTheDocument();
		const link = getByRole("link", { name: "resource" });
		expect(link).toHaveAttribute("href", "https://example.com/resource");
	});
});
