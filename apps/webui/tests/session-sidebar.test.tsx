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
				onArchiveSession={options?.onArchiveSession ?? (() => {})}
				onArchiveAllSessions={options?.onArchiveAllSessions ?? (() => {})}
				isBulkArchiving={options?.isBulkArchiving ?? false}
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
			selectedWorkspaceByMachine: {},
			expandedMachines: {},
			machineSidebarWidth: 56,
			sessionSidebarWidth: 256,
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
			selectedWorkspaceByMachine: {},
			expandedMachines: {},
			machineSidebarWidth: 56,
			sessionSidebarWidth: 256,
		});
		renderSidebar([buildSession()]);

		const input = screen.getByDisplayValue("Updated title");
		expect(input).toBeInTheDocument();
		expect(screen.getByText(i18n.t("common.save"))).toBeInTheDocument();
	});

	it("groups sessions by backend and sorts by recent use", () => {
		renderSidebar([
			buildSession({
				sessionId: "session-a1",
				title: "Alpha 1",
				backendId: "backend-a",
				backendLabel: "Backend Alpha",
				updatedAt: "2024-01-01T00:00:00.000Z",
				createdAt: "2024-01-01T00:00:00.000Z",
				cwd: "/home/user/alpha-1",
			}),
			buildSession({
				sessionId: "session-b1",
				title: "Beta 1",
				backendId: "backend-b",
				backendLabel: "Backend Beta",
				updatedAt: "2024-01-03T00:00:00.000Z",
				createdAt: "2024-01-03T00:00:00.000Z",
				cwd: "/home/user/beta-1",
			}),
			buildSession({
				sessionId: "session-a2",
				title: "Alpha 2",
				backendId: "backend-a",
				backendLabel: "Backend Alpha",
				updatedAt: "2024-01-02T00:00:00.000Z",
				createdAt: "2024-01-02T00:00:00.000Z",
				cwd: "/home/user/alpha-2",
			}),
		]);

		const groupHeaders = screen.getAllByText(/Backend (Alpha|Beta)/);
		expect(groupHeaders[0]).toHaveTextContent("Backend Beta");
		expect(groupHeaders[1]).toHaveTextContent("Backend Alpha");

		const alphaSessions = screen.getAllByText(/Alpha (1|2)/);
		expect(alphaSessions[0]).toHaveTextContent("Alpha 2");
		expect(alphaSessions[1]).toHaveTextContent("Alpha 1");
	});

	it("shows the last directory name for cwd", () => {
		renderSidebar([
			buildSession({
				sessionId: "session-cwd",
				title: "Session With Path",
				cwd: "/home/user/projects/mobvibe/",
			}),
		]);

		expect(screen.getByText("mobvibe")).toBeInTheDocument();
	});

	it("shows loading badge when session is loading", () => {
		renderSidebar([
			buildSession({
				sessionId: "session-loading",
				title: "Loading Session",
				isLoading: true,
			}),
		]);

		expect(screen.getByText(i18n.t("common.loading"))).toBeInTheDocument();
	});

	it("shows detached reason when present", () => {
		renderSidebar([
			buildSession({
				sessionId: "session-detached",
				title: "Detached Session",
				detachedReason: "gateway_disconnect",
			}),
		]);

		expect(
			screen.getByText(`${i18n.t("status.error")}: gateway_disconnect`),
		).toBeInTheDocument();
	});

	it("toggles group visibility when header is clicked", async () => {
		const user = userEvent.setup();
		renderSidebar([
			buildSession({
				sessionId: "session-toggle",
				title: "Toggle Session",
				backendId: "backend-toggle",
				backendLabel: "Backend Toggle",
			}),
		]);

		await user.click(screen.getByText("Backend Toggle"));
		expect(screen.queryByText("Toggle Session")).not.toBeInTheDocument();
		await user.click(screen.getByText("Backend Toggle"));
		expect(screen.getByText("Toggle Session")).toBeInTheDocument();
	});

	describe("Archive All", () => {
		it("is hidden when sessions list is empty", () => {
			renderSidebar([]);
			expect(
				screen.queryByText(i18n.t("session.archiveAll")),
			).not.toBeInTheDocument();
		});

		it("is visible when sessions exist", () => {
			renderSidebar([buildSession()]);
			expect(
				screen.getByText(i18n.t("session.archiveAll")),
			).toBeInTheDocument();
		});

		it("calls onArchiveAllSessions with all session IDs on confirm", async () => {
			const onArchiveAllSessions = vi.fn();
			const user = userEvent.setup();
			renderSidebar(
				[
					buildSession({ sessionId: "s1", title: "Session 1" }),
					buildSession({ sessionId: "s2", title: "Session 2" }),
				],
				{ onArchiveAllSessions },
			);

			await user.click(screen.getByText(i18n.t("session.archiveAllConfirm")));
			expect(onArchiveAllSessions).toHaveBeenCalledWith(["s1", "s2"]);
		});

		it("is disabled when isBulkArchiving is true", () => {
			renderSidebar([buildSession()], { isBulkArchiving: true });
			const button = screen.getByText(i18n.t("session.archiveAll"));
			expect(button.closest("button")).toBeDisabled();
		});
	});
});
