import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageItem } from "../src/components/chat/MessageItem";
import type { ChatMessage } from "../src/lib/chat-store";

const buildMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
	id: "message-1",
	role: "assistant",
	content: "hello",
	createdAt: new Date().toISOString(),
	isStreaming: false,
	...overrides,
});

describe("MessageItem", () => {
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
});
