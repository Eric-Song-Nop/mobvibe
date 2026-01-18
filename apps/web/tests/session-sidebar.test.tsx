import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionSidebar } from "../src/components/session/SessionSidebar";
import type { ChatSession } from "../src/lib/chat-store";

vi.mock("../src/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogAction: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		[key: string]: unknown;
	}) => <button {...props}>{children}</button>,
	AlertDialogCancel: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		[key: string]: unknown;
	}) => <button {...props}>{children}</button>,
}));

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
	sessionId: "session-1",
	title: "对话 1",
	input: "",
	messages: [],
	terminalOutputs: {},
	sending: false,
	canceling: false,
	streamingMessageId: undefined,
	...overrides,
});

const renderSidebar = (
	sessions: ChatSession[],
	options?: Partial<Parameters<typeof SessionSidebar>[0]>,
) =>
	render(
		<SessionSidebar
			sessions={sessions}
			activeSessionId={options?.activeSessionId}
			editingSessionId={options?.editingSessionId ?? null}
			editingTitle={options?.editingTitle ?? ""}
			onCreateSession={options?.onCreateSession ?? (() => {})}
			onSelectSession={options?.onSelectSession ?? (() => {})}
			onEditSession={options?.onEditSession ?? (() => {})}
			onEditCancel={options?.onEditCancel ?? (() => {})}
			onEditSubmit={options?.onEditSubmit ?? (() => {})}
			onEditingTitleChange={options?.onEditingTitleChange ?? (() => {})}
			onCloseSession={options?.onCloseSession ?? (() => {})}
			isCreating={options?.isCreating ?? false}
		/>,
	);

describe("SessionSidebar", () => {
	it("shows empty state when no sessions", () => {
		renderSidebar([]);
		expect(screen.getByText("暂无对话")).toBeInTheDocument();
	});

	it("selects a session when clicked", async () => {
		const onSelectSession = vi.fn();
		const user = userEvent.setup();
		renderSidebar([buildSession()], { onSelectSession });

		await user.click(screen.getByText("对话 1"));

		expect(onSelectSession).toHaveBeenCalledWith("session-1");
	});

	it("renders editing input when in edit mode", () => {
		renderSidebar([buildSession()], {
			editingSessionId: "session-1",
			editingTitle: "新的标题",
		});

		const input = screen.getByDisplayValue("新的标题");
		expect(input).toBeInTheDocument();
		expect(screen.getByText("保存")).toBeInTheDocument();
	});
});
