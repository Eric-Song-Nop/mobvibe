import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionSidebar } from "../src/components/session/SessionSidebar";
import { ThemeProvider } from "../src/components/theme-provider";
import i18n from "../src/i18n";
import type { ChatSession } from "../src/lib/chat-store";
import { useUiStore } from "../src/lib/ui-store";

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

vi.mock("../src/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectTrigger: ({ children, ...props }: { children: React.ReactNode }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => (
		<span>{placeholder}</span>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("../src/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
	sessionId: "session-1",
	title: i18n.t("session.newTitle", { count: 1 }),
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
		<ThemeProvider>
			<SessionSidebar
				sessions={sessions}
				activeSessionId={options?.activeSessionId}
				onCreateSession={options?.onCreateSession ?? (() => {})}
				onSelectSession={options?.onSelectSession ?? (() => {})}
				onEditSubmit={options?.onEditSubmit ?? (() => {})}
				onCloseSession={options?.onCloseSession ?? (() => {})}
				isCreating={options?.isCreating ?? false}
			/>
		</ThemeProvider>,
	);

describe("SessionSidebar", () => {
	beforeEach(() => {
		useUiStore.setState({
			mobileMenuOpen: false,
			createDialogOpen: false,
			fileExplorerOpen: false,
			filePreviewPath: undefined,
			editingSessionId: null,
			editingTitle: "",
			draftTitle: "",
			draftBackendId: undefined,
			draftCwd: undefined,
		});
	});

	it("shows empty state when no sessions", () => {
		renderSidebar([]);
		expect(screen.getByText(i18n.t("session.empty"))).toBeInTheDocument();
	});

	it("selects a session when clicked", async () => {
		const onSelectSession = vi.fn();
		const user = userEvent.setup();
		renderSidebar([buildSession()], { onSelectSession });

		await user.click(
			screen.getByText(i18n.t("session.newTitle", { count: 1 })),
		);

		expect(onSelectSession).toHaveBeenCalledWith("session-1");
	});

	it("renders editing input when in edit mode", () => {
		useUiStore.setState({
			editingSessionId: "session-1",
			editingTitle: "Updated title",
		});
		renderSidebar([buildSession()]);

		const input = screen.getByDisplayValue("Updated title");
		expect(input).toBeInTheDocument();
		expect(screen.getByText(i18n.t("common.save"))).toBeInTheDocument();
	});
});
