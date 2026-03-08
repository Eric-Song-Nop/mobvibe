import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
			};
			return translations[key] ?? key;
		},
	}),
}));

vi.mock("@hugeicons/react", () => ({
	HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@/components/ui/button", () => ({
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

vi.mock("@/components/ui/tooltip", () => ({
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

vi.mock("@/components/ui/ResizeHandle", () => ({
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
		onArchiveSessionRequest,
		onArchiveAllSessionsRequest,
	}: {
		onCreateSession: (mode: "workspace" | "session") => void;
		onArchiveSessionRequest: (sessionId: string) => void;
		onArchiveAllSessionsRequest: (sessionIds: string[]) => void;
	}) => (
		<div>
			<button type="button" onClick={() => onCreateSession("session")}>
				New Session
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

vi.mock("@/components/ui/alert-dialog", () => ({
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
	}: {
		children: ReactNode;
		onClick?: () => void;
	}) => (
		<button type="button" onClick={onClick}>
			{children}
		</button>
	),
	AlertDialogCancel: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
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
});
