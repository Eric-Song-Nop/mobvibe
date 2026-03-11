import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionSidebar } from "../src/components/session/SessionSidebar";
import { ThemeProvider } from "../src/components/theme-provider";
import i18n from "../src/i18n";
import type { ChatSession } from "../src/lib/chat-store";
import type { SessionMutationsSnapshot } from "../src/lib/session-utils";
import { useUiStore } from "../src/lib/ui-store";

const defaultMutations: SessionMutationsSnapshot = {
	loadSessionPending: false,
	loadSessionVariables: undefined,
	reloadSessionPending: false,
	reloadSessionVariables: undefined,
};

// --- mocks ---

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
	DropdownMenuItem: ({
		children,
		onClick,
	}: {
		children: React.ReactNode;
		onClick?: () => void;
		variant?: string;
	}) => (
		<button type="button" onClick={onClick}>
			{children}
		</button>
	),
}));

vi.mock("../src/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	TooltipContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	TooltipProvider: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("../src/lib/machines-store", () => ({
	useMachinesStore: vi.fn(() => ({
		selectedMachineId: "machine-1",
		machines: {},
		setSelectedMachineId: vi.fn(),
		updateBackendCapabilities: vi.fn(),
	})),
}));

vi.mock("../src/components/workspace/WorkspaceList", () => ({
	WorkspaceList: () => <div data-testid="workspace-list">WorkspaceList</div>,
}));

// --- helpers ---

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
		<MemoryRouter>
			<ThemeProvider>
				<SessionSidebar
					sessions={sessions}
					activeSessionId={options?.activeSessionId}
					onCreateSession={options?.onCreateSession ?? (() => {})}
					onSelectSession={options?.onSelectSession ?? (() => {})}
					onEditSubmit={options?.onEditSubmit ?? (() => {})}
					onArchiveSessionRequest={
						options?.onArchiveSessionRequest ?? (() => {})
					}
					onArchiveAllSessionsRequest={
						options?.onArchiveAllSessionsRequest ?? (() => {})
					}
					isBulkArchiving={options?.isBulkArchiving ?? false}
					isCreating={options?.isCreating ?? false}
					mutations={options?.mutations ?? defaultMutations}
				/>
			</ThemeProvider>
		</MemoryRouter>,
	);

// --- tests ---

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
			sidebarTab: "sessions",
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
			sidebarTab: "sessions",
			machineSidebarWidth: 56,
			sessionSidebarWidth: 256,
		});
		renderSidebar([buildSession()]);

		const input = screen.getByDisplayValue("Updated title");
		expect(input).toBeInTheDocument();
	});

	it("submits rename on Enter key", async () => {
		const onEditSubmit = vi.fn();
		const user = userEvent.setup();
		useUiStore.setState({
			editingSessionId: "session-1",
			editingTitle: "New name",
			selectedWorkspaceByMachine: {},
			sidebarTab: "sessions",
			machineSidebarWidth: 56,
			sessionSidebarWidth: 256,
		});
		renderSidebar([buildSession()], { onEditSubmit });

		const input = screen.getByDisplayValue("New name");
		await user.click(input);
		await user.keyboard("{Enter}");

		expect(onEditSubmit).toHaveBeenCalled();
	});

	it("cancels rename on Escape key", async () => {
		const user = userEvent.setup();
		useUiStore.setState({
			editingSessionId: "session-1",
			editingTitle: "New name",
			selectedWorkspaceByMachine: {},
			sidebarTab: "sessions",
			machineSidebarWidth: 56,
			sessionSidebarWidth: 256,
		});
		renderSidebar([buildSession()]);

		const input = screen.getByDisplayValue("New name");
		await user.click(input);
		await user.keyboard("{Escape}");

		// After escape, editing should be cleared — title text should show again
		expect(screen.queryByDisplayValue("New name")).not.toBeInTheDocument();
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

	it("shows relative time in metadata row", () => {
		const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
		renderSidebar([
			buildSession({
				sessionId: "session-time",
				title: "Session With Time",
				updatedAt: oneHourAgo,
			}),
		]);

		expect(screen.getByText(/1h ago/)).toBeInTheDocument();
	});

	it("limits the default visible session count and expands on demand", async () => {
		const user = userEvent.setup();
		const sessions = Array.from({ length: 9 }, (_, index) =>
			buildSession({
				sessionId: `session-${index + 1}`,
				title: `Session ${index + 1}`,
				backendId: "backend-a",
				backendLabel: "Backend Alpha",
				createdAt: `2024-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
				updatedAt: `2024-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
			}),
		);

		renderSidebar(sessions);

		expect(screen.getByText("Session 9")).toBeInTheDocument();
		expect(screen.queryByText("Session 1")).not.toBeInTheDocument();

		await user.click(
			screen.getByRole("button", {
				name: i18n.t("session.showMore", { count: 1 }),
			}),
		);

		expect(screen.getByText("Session 1")).toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: i18n.t("session.showLess"),
			}),
		).toBeInTheDocument();
	});

	it("does not render empty group headers beyond the default limit", () => {
		const sessions = Array.from({ length: 9 }, (_, index) =>
			buildSession({
				sessionId: `session-group-${index + 1}`,
				title: `Grouped Session ${index + 1}`,
				backendId: `backend-${index + 1}`,
				backendLabel: `Backend ${index + 1}`,
				createdAt: `2024-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
				updatedAt: `2024-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
			}),
		);

		renderSidebar(sessions);

		expect(screen.getByText("Backend 9")).toBeInTheDocument();
		expect(screen.queryByText("Backend 1")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: i18n.t("session.showMore", { count: 1 }),
			}),
		).toBeInTheDocument();
	});

	it("shows status tooltip for loading session", () => {
		renderSidebar([
			buildSession({
				sessionId: "session-loading",
				title: "Loading Session",
				isLoading: true,
			}),
		]);

		expect(
			screen.getByText(i18n.t("session.status.loading")),
		).toBeInTheDocument();
	});

	it("shows loading status for the session targeted by load mutation", () => {
		renderSidebar(
			[
				buildSession({
					sessionId: "session-a",
					title: "Session A",
					isAttached: true,
				}),
				buildSession({
					sessionId: "session-b",
					title: "Session B",
					isAttached: false,
				}),
			],
			{
				mutations: {
					loadSessionPending: true,
					loadSessionVariables: { sessionId: "session-b" },
					reloadSessionPending: false,
					reloadSessionVariables: undefined,
				},
			},
		);

		expect(
			screen.getByText(i18n.t("session.status.loading")),
		).toBeInTheDocument();
		expect(screen.getByText("Session A")).toBeInTheDocument();
		expect(screen.getByText("Session B")).toBeInTheDocument();
	});

	it("shows detached reason in tooltip", () => {
		renderSidebar([
			buildSession({
				sessionId: "session-detached",
				title: "Detached Session",
				detachedReason: "gateway_disconnect",
			}),
		]);

		expect(
			screen.getByText(
				`${i18n.t("session.status.detached")}: gateway_disconnect`,
			),
		).toBeInTheDocument();
	});

	it("shows error message in tooltip", () => {
		renderSidebar([
			buildSession({
				sessionId: "session-err",
				title: "Error Session",
				error: { message: "connection lost", code: "ERR" },
			}),
		]);

		expect(
			screen.getByText(`${i18n.t("session.status.error")}: connection lost`),
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

		// Group header includes label + count
		await user.click(screen.getByText(/Backend Toggle/));
		expect(screen.queryByText("Toggle Session")).not.toBeInTheDocument();
		await user.click(screen.getByText(/Backend Toggle/));
		expect(screen.getByText("Toggle Session")).toBeInTheDocument();
	});

	it("shows rename and archive in dropdown menu", () => {
		renderSidebar([buildSession({ title: "My Session" })]);

		expect(screen.getByText(i18n.t("common.rename"))).toBeInTheDocument();
		expect(screen.getByText(i18n.t("common.archive"))).toBeInTheDocument();
	});

	it("triggers edit mode from dropdown rename", async () => {
		const user = userEvent.setup();
		renderSidebar([buildSession({ title: "My Session" })]);

		await user.click(screen.getByText(i18n.t("common.rename")));

		// Should now be in editing mode with an input
		const input = screen.getByRole("textbox", { name: "Session title" });
		expect(input).toBeInTheDocument();
	});

	it("applies active indicator to the current session", () => {
		renderSidebar(
			[buildSession({ sessionId: "active-1", title: "Active Session" })],
			{ activeSessionId: "active-1" },
		);

		// The outer card div has the border-l-primary class
		const card = screen
			.getByText("Active Session")
			.closest(".border-l-primary");
		expect(card).toBeInTheDocument();
	});

	describe("Tab switching", () => {
		it("shows sessions tab by default", () => {
			renderSidebar([buildSession({ title: "My Session" })]);
			expect(screen.getByText("My Session")).toBeInTheDocument();
		});

		it("switches to workspaces tab when clicked", async () => {
			const user = userEvent.setup();
			renderSidebar([buildSession({ title: "My Session" })]);

			await user.click(screen.getByText(i18n.t("workspace.title")));

			// WorkspaceList mock should be rendered
			expect(screen.getByTestId("workspace-list")).toBeInTheDocument();
			// Session items should not be visible
			expect(screen.queryByText("My Session")).not.toBeInTheDocument();
		});

		it("switches back to sessions tab", async () => {
			const user = userEvent.setup();
			useUiStore.setState({ sidebarTab: "workspaces" });
			renderSidebar([buildSession({ title: "My Session" })]);

			await user.click(screen.getByText(i18n.t("session.title")));

			expect(screen.getByText("My Session")).toBeInTheDocument();
		});
	});

	describe("Archive All", () => {
		it("is hidden when group has only one session", () => {
			renderSidebar([buildSession()]);
			expect(
				screen.queryByText(i18n.t("session.archiveAll")),
			).not.toBeInTheDocument();
		});

		it("is visible when group has multiple sessions", () => {
			renderSidebar([
				buildSession({
					sessionId: "s1",
					title: "Session 1",
					backendId: "b1",
					backendLabel: "Backend",
				}),
				buildSession({
					sessionId: "s2",
					title: "Session 2",
					backendId: "b1",
					backendLabel: "Backend",
				}),
			]);
			expect(
				screen.getByText(i18n.t("session.archiveAll")),
			).toBeInTheDocument();
		});

		it("emits archive-all intent immediately", async () => {
			const onArchiveAllSessionsRequest = vi.fn();
			const user = userEvent.setup();
			renderSidebar(
				[
					buildSession({
						sessionId: "s1",
						title: "Session 1",
						backendId: "b1",
						backendLabel: "Backend",
					}),
					buildSession({
						sessionId: "s2",
						title: "Session 2",
						backendId: "b1",
						backendLabel: "Backend",
					}),
				],
				{ onArchiveAllSessionsRequest },
			);

			await user.click(screen.getByText(i18n.t("session.archiveAll")));

			expect(onArchiveAllSessionsRequest).toHaveBeenCalledWith(["s1", "s2"]);
		});

		it("is disabled when isBulkArchiving is true", () => {
			renderSidebar(
				[
					buildSession({
						sessionId: "s1",
						title: "Session 1",
						backendId: "b1",
						backendLabel: "Backend",
					}),
					buildSession({
						sessionId: "s2",
						title: "Session 2",
						backendId: "b1",
						backendLabel: "Backend",
					}),
				],
				{ isBulkArchiving: true },
			);
			const button = screen
				.getByText(i18n.t("session.archiveAll"))
				.closest("button");
			expect(button).toBeDisabled();
		});
	});

	describe("Archive single session", () => {
		it("emits archive intent via dropdown", async () => {
			const onArchiveSessionRequest = vi.fn();
			const user = userEvent.setup();
			renderSidebar([buildSession({ sessionId: "s1", title: "My Session" })], {
				onArchiveSessionRequest,
			});

			await user.click(screen.getByText(i18n.t("common.archive")));

			expect(onArchiveSessionRequest).toHaveBeenCalledWith("s1");
		});
	});
});
