import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMachinesStore } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";
import { AppSidebar } from "../AppSidebar";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, number>) => {
			const translations: Record<string, string> = {
				"common.closeMenu": "Close menu",
				"common.cancel": "Cancel",
				"machines.title": "Machines",
				"machines.refresh": "Refresh",
				"machines.register": "Register Machine",
				"machines.empty": "No machines",
				"session.archiveTitle": "Archive session",
				"session.archiveDescription": "Archive this session",
				"session.archiveConfirm": "Confirm archive",
				"session.archiveAllTitle": "Archive all sessions",
				"session.archiveAllDescription": `Archive ${options?.count ?? 0} sessions`,
				"session.archiveAllConfirm": "Confirm archive all",
				"session.closeTitle": "Close session",
				"session.closeDescription": "Close this session and keep history",
				"session.closeConfirm": "Confirm close",
				"session.deleteTitle": "Delete Session?",
				"session.deleteDescription": "Delete Agent and Mobvibe copies",
				"session.deleteConfirm": "Delete Session",
				"session.deleting": "Deleting…",
			};
			return translations[key] ?? key;
		},
	}),
}));

vi.mock("@hugeicons/react", () => ({
	HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@mobvibe/ui/button", () => ({
	Button: ({
		children,
		onClick,
		...props
	}: {
		children: ReactNode;
		onClick?: () => void;
		[key: string]: unknown;
	}) => (
		<button type="button" onClick={onClick} {...props}>
			{children}
		</button>
	),
}));

vi.mock("@mobvibe/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipTrigger: ({
		children,
	}: {
		children: ReactNode;
		asChild?: boolean;
	}) => <>{children}</>,
	TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@mobvibe/ui/resize-handle", () => ({
	ResizeHandle: () => null,
}));

vi.mock("@/components/machines/RegisterMachineDialog", () => ({
	RegisterMachineDialog: ({
		open,
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
	}) =>
		open ? (
			<div data-testid="register-machine-dialog">Register dialog</div>
		) : null,
}));

vi.mock("@/components/session/SessionSidebar", () => ({
	SessionSidebar: ({
		onCreateSession,
		onCloseSessionRequest,
		onDeleteSessionRequest,
		onArchiveSessionRequest,
		onArchiveAllSessionsRequest,
	}: {
		onCreateSession: (mode: "workspace" | "session") => void;
		onCloseSessionRequest: (sessionId: string) => void;
		onDeleteSessionRequest: (sessionId: string) => void;
		onArchiveSessionRequest: (sessionId: string) => void;
		onArchiveAllSessionsRequest: (sessionIds: string[]) => void;
	}) => (
		<div>
			<button type="button" onClick={() => onCreateSession("session")}>
				New Session
			</button>
			<button type="button" onClick={() => onCloseSessionRequest("session-1")}>
				Close One
			</button>
			<button type="button" onClick={() => onDeleteSessionRequest("session-1")}>
				Delete One
			</button>
			<button
				type="button"
				onClick={() => onArchiveSessionRequest("session-1")}
			>
				Archive One
			</button>
			<button
				type="button"
				onClick={() => onArchiveAllSessionsRequest(["session-1", "session-2"])}
			>
				Archive All
			</button>
		</div>
	),
}));

vi.mock("@mobvibe/ui/alert-dialog", () => ({
	AlertDialog: ({
		children,
		open,
	}: {
		children: ReactNode;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	}) => (open ? <div data-testid="archive-dialog">{children}</div> : null),
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogAction: ({
		children,
		onClick,
		disabled,
	}: {
		children: ReactNode;
		onClick?: () => void;
		disabled?: boolean;
		variant?: string;
	}) => (
		<button type="button" disabled={disabled} onClick={onClick}>
			{children}
		</button>
	),
	AlertDialogCancel: ({
		children,
		onClick,
		disabled,
	}: {
		children: ReactNode;
		onClick?: () => void;
		disabled?: boolean;
	}) => (
		<button type="button" disabled={disabled} onClick={onClick}>
			{children}
		</button>
	),
}));

vi.mock("@/hooks/useMachinesQuery", () => ({
	useMachinesQuery: () => ({
		refetch: vi.fn().mockResolvedValue({ data: { machines: [] } }),
	}),
}));

vi.mock("@/hooks/useSessionQueries", () => ({
	useDiscoverSessionsMutation: () => ({
		mutateAsync: vi.fn().mockResolvedValue({ backendCapabilities: {} }),
	}),
}));

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false },
	},
});

const renderSidebar = (
	props?: Partial<React.ComponentProps<typeof AppSidebar>>,
) =>
	render(
		<QueryClientProvider client={queryClient}>
			<AppSidebar
				sessions={[]}
				activeSessionId={undefined}
				onCreateSession={props?.onCreateSession ?? vi.fn()}
				onSelectSession={props?.onSelectSession ?? vi.fn()}
				onEditSubmit={props?.onEditSubmit ?? vi.fn()}
				onCloseSession={props?.onCloseSession ?? vi.fn()}
				onDeleteSession={
					props?.onDeleteSession ?? vi.fn().mockResolvedValue(true)
				}
				onArchiveSession={props?.onArchiveSession ?? vi.fn()}
				onArchiveAllSessions={props?.onArchiveAllSessions ?? vi.fn()}
				isBulkArchiving={props?.isBulkArchiving ?? false}
				isCreating={props?.isCreating ?? false}
				mutations={
					props?.mutations ?? {
						loadSessionPending: false,
						loadSessionVariables: undefined,
						reloadSessionPending: false,
						reloadSessionVariables: undefined,
					}
				}
			/>
		</QueryClientProvider>,
	);

describe("AppSidebar mobile modal flow", () => {
	beforeEach(() => {
		useUiStore.setState({
			mobileMenuOpen: true,
			sessionSidebarWidth: 256,
			selectedWorkspaceByMachine: {},
		});
		useMachinesStore.setState({
			machines: {
				"machine-1": {
					machineId: "machine-1",
					hostname: "dev-box",
					connected: true,
				},
			},
			selectedMachineId: "machine-1",
		});
	});

	it("closes the mobile menu when opening create session", async () => {
		const onCreateSession = vi.fn();
		const user = userEvent.setup();
		renderSidebar({ onCreateSession });

		await user.click(screen.getAllByText("New Session")[0]!);

		expect(onCreateSession).toHaveBeenCalledWith("session");
		expect(useUiStore.getState().mobileMenuOpen).toBe(false);
		expect(
			screen.queryByRole("button", { name: "Close menu" }),
		).not.toBeInTheDocument();
	});

	it("keeps the register-machine dialog mounted after closing the mobile menu", async () => {
		const user = userEvent.setup();
		renderSidebar();

		await user.click(screen.getByRole("button", { name: "Register Machine" }));

		expect(useUiStore.getState().mobileMenuOpen).toBe(false);
		expect(screen.getByTestId("register-machine-dialog")).toBeInTheDocument();
	});

	it("keeps archive confirmation open after closing the mobile menu", async () => {
		const onArchiveSession = vi.fn();
		const user = userEvent.setup();
		renderSidebar({ onArchiveSession });

		await user.click(screen.getAllByText("Archive One")[0]!);

		expect(useUiStore.getState().mobileMenuOpen).toBe(false);
		expect(screen.getByTestId("archive-dialog")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Confirm archive" }));

		expect(onArchiveSession).toHaveBeenCalledWith("session-1");
	});

	it("keeps close confirmation open and calls the distinct close action", async () => {
		const onCloseSession = vi.fn();
		const onArchiveSession = vi.fn();
		const user = userEvent.setup();
		renderSidebar({ onCloseSession, onArchiveSession });

		await user.click(screen.getAllByText("Close One")[0]!);

		expect(useUiStore.getState().mobileMenuOpen).toBe(false);
		expect(
			screen.getByText("Close this session and keep history"),
		).toBeVisible();

		await user.click(screen.getByRole("button", { name: "Confirm close" }));

		expect(onCloseSession).toHaveBeenCalledWith("session-1");
		expect(onArchiveSession).not.toHaveBeenCalled();
	});

	it("uses a separate delete confirmation and honors cancel", async () => {
		const onDeleteSession = vi.fn().mockResolvedValue(true);
		const user = userEvent.setup();
		renderSidebar({ onDeleteSession });

		await user.click(screen.getAllByText("Delete One")[0]!);

		expect(screen.getByText("Delete Agent and Mobvibe copies")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onDeleteSession).not.toHaveBeenCalled();
		expect(
			screen.queryByText("Delete Agent and Mobvibe copies"),
		).not.toBeInTheDocument();
	});

	it("confirms delete through its distinct handler", async () => {
		const onDeleteSession = vi.fn().mockResolvedValue(true);
		const onArchiveSession = vi.fn();
		const user = userEvent.setup();
		renderSidebar({ onDeleteSession, onArchiveSession });

		await user.click(screen.getAllByText("Delete One")[0]!);
		await user.click(screen.getByRole("button", { name: "Delete Session" }));

		expect(onDeleteSession).toHaveBeenCalledTimes(1);
		expect(onDeleteSession).toHaveBeenCalledWith("session-1");
		expect(onArchiveSession).not.toHaveBeenCalled();
	});

	it("disables duplicate delete confirmation while the request is pending", async () => {
		let resolveDelete: ((deleted: boolean) => void) | undefined;
		const onDeleteSession = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					resolveDelete = resolve;
				}),
		);
		const user = userEvent.setup();
		renderSidebar({ onDeleteSession });

		await user.click(screen.getAllByText("Delete One")[0]!);
		await user.click(screen.getByRole("button", { name: "Delete Session" }));

		const pendingButton = screen.getByRole("button", { name: "Deleting…" });
		expect(pendingButton).toBeDisabled();
		await user.click(pendingButton);
		expect(onDeleteSession).toHaveBeenCalledTimes(1);

		resolveDelete?.(true);
		await waitFor(() => {
			expect(screen.queryByText("Delete Agent and Mobvibe copies")).toBeNull();
		});
	});
});
