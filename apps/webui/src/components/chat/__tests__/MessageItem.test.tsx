import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MessageItem } from "../MessageItem";

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string) => {
				const translations: Record<string, string> = {
					"chat.copyMessage": "Copy",
					"chat.messagePending": "Sending…",
					"chat.messageFailed": "Send failed",
					"chat.messageFailedHint": "Draft restored below.",
				};
				return translations[key] ?? key;
			},
		}),
	};
});

vi.mock("@hugeicons/react", () => ({
	HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@/components/chat/DiffView", () => ({
	UnifiedDiffView: () => <div data-testid="diff-view" />,
	buildUnifiedDiffString: () => "",
}));

vi.mock("@/components/chat/LazyStreamdown", () => ({
	LazyStreamdown: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@/lib/chat-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-store")>();
	return {
		...actual,
		useChatStore: vi.fn(() => undefined),
		selectTerminalOutputSnapshot: vi.fn(() => undefined),
	};
});

describe("MessageItem", () => {
	it("shows a pending badge for provisional user messages", () => {
		render(
			<MessageItem
				message={{
					id: "msg-1",
					role: "user",
					kind: "text",
					content: "Hello",
					contentBlocks: [{ type: "text", text: "Hello" }],
					createdAt: "2026-03-14T00:00:00.000Z",
					isStreaming: false,
					provisional: true,
				}}
			/>,
		);

		expect(screen.getByText("Sending…")).toBeInTheDocument();
		expect(screen.queryByText("Draft restored below.")).not.toBeInTheDocument();
		expect(screen.getByText("Hello")).toBeInTheDocument();
	});

	it("shows a failed badge and follow-up hint for failed provisional messages", () => {
		render(
			<MessageItem
				message={{
					id: "msg-2",
					role: "user",
					kind: "text",
					content: "Hello again",
					contentBlocks: [{ type: "text", text: "Hello again" }],
					createdAt: "2026-03-14T00:00:00.000Z",
					isStreaming: false,
					provisional: true,
					failed: true,
				}}
			/>,
		);

		expect(screen.getByText("Send failed")).toBeInTheDocument();
		expect(screen.getByText("Draft restored below.")).toBeInTheDocument();
		expect(screen.getByText("Hello again")).toBeInTheDocument();
	});
});
