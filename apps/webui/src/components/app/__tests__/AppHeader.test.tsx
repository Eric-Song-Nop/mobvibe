import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { AppHeader } from "../AppHeader";

const mockUseIsMobile = vi.fn(() => false);

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, string>) => {
			const translations: Record<string, string> = {
				"commandPalette.openCommandPalette": "Open Command Palette",
				"common.toggleMenu": "Toggle menu",
				"session.syncHistory": "Sync History",
				"session.syncingHistory": "Synchronizing history…",
				"session.historyMayBeStale":
					"History may be out of date. Try syncing again.",
				"session.forceReloadTitle": "Force Reload",
				"session.forceReloadDescription": "This will force reload the session.",
				"session.forceReloadConfirm": "Reload",
				"session.context.details": "Session Details",
				"session.context.workspacePathLabel": "Workspace Path",
				"session.context.executionModeLabel": "Execution Mode",
				"session.context.branchLabel": "Branch",
				"session.context.subdirectoryLabel": "Subdirectory",
				"session.context.contextLeftLabel": "Context Left",
				"session.context.local": "Local",
				"session.context.worktree": "Worktree",
				"session.context.subdir": `Subdir: ${options?.path ?? ""}`,
				"common.cancel": "Cancel",
				"fileExplorer.openFileExplorer": "Open File Explorer",
			};
			return translations[key] || key;
		},
		i18n: {
			language: "en",
			changeLanguage: vi.fn(),
		},
	}),
}));

// Mock AuthProvider
vi.mock("@/components/auth/AuthProvider", () => ({
	useAuth: () => ({
		user: { email: "test@example.com", name: "Test User" },
		signOut: vi.fn(),
	}),
	AuthProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

// Mock UserMenu
vi.mock("@/components/auth/UserMenu", () => ({
	UserMenu: () => <div data-testid="user-menu">UserMenu</div>,
}));

// Mock PlanIndicator
vi.mock("@/components/plan/plan-indicator", () => ({
	default: () => <div data-testid="plan-indicator">PlanIndicator</div>,
}));

vi.mock("@/hooks/use-mobile", () => ({
	useIsMobile: () => mockUseIsMobile(),
}));

const PopoverContext = React.createContext<{
	open: boolean;
	setOpen: React.Dispatch<React.SetStateAction<boolean>>;
} | null>(null);

vi.mock("@/components/ui/popover", () => ({
	Popover: ({
		children,
		open,
		onOpenChange,
	}: {
		children: React.ReactNode;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	}) => {
		const [internalOpen, setInternalOpen] = React.useState(false);
		const resolvedOpen = open ?? internalOpen;
		const setOpen = (value: React.SetStateAction<boolean>) => {
			const nextOpen =
				typeof value === "function" ? value(resolvedOpen) : value;
			onOpenChange?.(nextOpen);
			if (open === undefined) {
				setInternalOpen(nextOpen);
			}
		};

		return (
			<PopoverContext.Provider value={{ open: resolvedOpen, setOpen }}>
				{children}
			</PopoverContext.Provider>
		);
	},
	PopoverTrigger: ({
		children,
		asChild,
	}: {
		children: React.ReactNode;
		asChild?: boolean;
	}) => {
		const context = React.useContext(PopoverContext);
		if (!context) {
			return null;
		}
		if (asChild && React.isValidElement(children)) {
			return React.cloneElement(
				children as React.ReactElement<{ onClick?: () => void }>,
				{
					onClick: () => context.setOpen((current) => !current),
				},
			);
		}
		return (
			<button
				type="button"
				onClick={() => context.setOpen((current) => !current)}
			>
				{children}
			</button>
		);
	},
	PopoverContent: ({ children }: { children: React.ReactNode }) => {
		const context = React.useContext(PopoverContext);
		if (!context?.open) {
			return null;
		}
		return <div data-testid="popover-content">{children}</div>;
	},
}));

const SheetContext = React.createContext<{ open: boolean } | null>(null);

vi.mock("@/components/ui/sheet", () => ({
	Sheet: ({
		children,
		open = false,
	}: {
		children: React.ReactNode;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	}) => (
		<SheetContext.Provider value={{ open }}>{children}</SheetContext.Provider>
	),
	SheetContent: ({ children }: { children: React.ReactNode }) => {
		const context = React.useContext(SheetContext);
		if (!context?.open) {
			return null;
		}
		return <div data-testid="sheet-content">{children}</div>;
	},
	SheetHeader: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="sheet-header">{children}</div>
	),
	SheetTitle: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="sheet-title">{children}</div>
	),
}));

// Mock AlertDialog
vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({
		children,
	}: {
		children: React.ReactNode;
		open?: boolean;
	}) => <div data-testid="alert-dialog">{children}</div>,
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="alert-dialog-content">{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="alert-dialog-header">{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="alert-dialog-title">{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="alert-dialog-description">{children}</div>
	),
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="alert-dialog-footer">{children}</div>
	),
	AlertDialogAction: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		[key: string]: unknown;
	}) => (
		<button {...props} data-testid="alert-dialog-action">
			{children}
		</button>
	),
	AlertDialogCancel: ({
		children,
		...props
	}: {
		children: React.ReactNode;
		[key: string]: unknown;
	}) => (
		<button {...props} data-testid="alert-dialog-cancel">
			{children}
		</button>
	),
	AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="alert-dialog-trigger">{children}</div>
	),
}));

// Mock Badge
vi.mock("@/components/ui/badge", () => ({
	Badge: ({
		children,
		variant,
		...props
	}: {
		children: React.ReactNode;
		variant?: string;
		[key: string]: unknown;
	}) => (
		<span data-testid="badge" data-variant={variant} {...props}>
			{children}
		</span>
	),
}));

// Mock Button
vi.mock("@/components/ui/button", () => ({
	Button: ({
		children,
		onClick,
		variant,
		size,
		className,
		...props
	}: {
		children: React.ReactNode;
		onClick?: () => void;
		variant?: string;
		size?: string;
		className?: string;
		[key: string]: unknown;
	}) => (
		<button
			onClick={onClick}
			data-variant={variant}
			data-size={size}
			className={className}
			{...props}
		>
			{children}
		</button>
	),
}));

const renderAppHeader = (
	props: Partial<Parameters<typeof AppHeader>[0]> = {},
) =>
	render(
		<MemoryRouter>
			<ThemeProvider>
				<AppHeader
					onOpenMobileMenu={vi.fn()}
					onOpenCommandPalette={vi.fn()}
					{...props}
				/>
			</ThemeProvider>
		</MemoryRouter>,
	);

describe("AppHeader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseIsMobile.mockReturnValue(false);
	});

	describe("Command Palette Button", () => {
		it("renders command palette button on desktop screens", () => {
			renderAppHeader();
			const button = screen.getByLabelText("Open Command Palette");
			expect(button).toBeInTheDocument();
		});

		it("has correct aria-label", () => {
			renderAppHeader();
			const button = screen.getByLabelText("Open Command Palette");
			expect(button).toHaveAttribute("aria-label", "Open Command Palette");
		});

		it("has title attribute for tooltip", () => {
			renderAppHeader();
			const button = screen.getByLabelText("Open Command Palette");
			expect(button).toHaveAttribute("title", "Open Command Palette");
		});

		it("calls onOpenCommandPalette when clicked", async () => {
			const onOpenCommandPalette = vi.fn();
			renderAppHeader({ onOpenCommandPalette });
			const user = userEvent.setup();

			const button = screen.getByLabelText("Open Command Palette");
			await user.click(button);

			expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
		});

		it("uses outline variant", () => {
			renderAppHeader();
			const button = screen.getByLabelText("Open Command Palette");
			expect(button).toHaveAttribute("data-variant", "outline");
		});

		it("uses icon-sm size", () => {
			renderAppHeader();
			const button = screen.getByLabelText("Open Command Palette");
			expect(button).toHaveAttribute("data-size", "icon-sm");
		});

		it("is positioned next to UserMenu", () => {
			renderAppHeader();
			const commandButton = screen.getByLabelText("Open Command Palette");
			const userMenu = screen.getByTestId("user-menu");

			expect(commandButton).toBeInTheDocument();
			expect(userMenu).toBeInTheDocument();
		});
	});

	describe("Mobile Menu Button", () => {
		it("renders mobile menu button", () => {
			renderAppHeader();
			const button = screen.getByLabelText("Toggle menu");
			expect(button).toBeInTheDocument();
		});

		it("calls onOpenMobileMenu when clicked", async () => {
			const onOpenMobileMenu = vi.fn();
			renderAppHeader({ onOpenMobileMenu });
			const user = userEvent.setup();

			const button = screen.getByLabelText("Toggle menu");
			await user.click(button);

			expect(onOpenMobileMenu).toHaveBeenCalledTimes(1);
		});
	});

	describe("Optional Features", () => {
		it("shows backend label when provided", () => {
			renderAppHeader({ backendLabel: "Test Backend" });
			expect(screen.getByTestId("session-header-summary")).toHaveTextContent(
				"Test Backend",
			);
		});

		it("shows plan indicator when plan is provided", () => {
			renderAppHeader({
				plan: [{ content: "test-step", priority: "medium", status: "pending" }],
			});
			expect(screen.getByTestId("plan-indicator")).toBeInTheDocument();
		});

		it("shows sync history button when enabled", () => {
			renderAppHeader({ showSyncHistory: true });
			expect(screen.getByLabelText("Sync History")).toBeInTheDocument();
		});

		it("calls onSyncHistory when sync history is clicked", async () => {
			const onSyncHistory = vi.fn();
			const user = userEvent.setup();
			renderAppHeader({ showSyncHistory: true, onSyncHistory });

			await user.click(screen.getByLabelText("Sync History"));

			expect(onSyncHistory).toHaveBeenCalledTimes(1);
		});

		it("disables sync history button when requested", () => {
			renderAppHeader({ showSyncHistory: true, syncHistoryDisabled: true });
			expect(screen.getByLabelText("Sync History")).toBeDisabled();
		});

		it("shows force reload button when enabled", () => {
			renderAppHeader({ showForceReload: true });
			expect(screen.getByLabelText("Force Reload")).toBeInTheDocument();
		});

		it("calls onForceReload only when confirm is clicked", async () => {
			const onForceReload = vi.fn();
			const user = userEvent.setup();
			renderAppHeader({ showForceReload: true, onForceReload });

			await user.click(screen.getByTestId("alert-dialog-action"));

			expect(onForceReload).toHaveBeenCalledTimes(1);
		});

		it("does not call onForceReload when cancel is clicked", async () => {
			const onForceReload = vi.fn();
			const user = userEvent.setup();
			renderAppHeader({ showForceReload: true, onForceReload });

			await user.click(screen.getByTestId("alert-dialog-cancel"));

			expect(onForceReload).not.toHaveBeenCalled();
		});

		it("disables force reload button when requested", () => {
			renderAppHeader({ showForceReload: true, forceReloadDisabled: true });
			expect(screen.getByLabelText("Force Reload")).toBeDisabled();
		});

		it("shows file explorer button when enabled", () => {
			renderAppHeader({ showFileExplorer: true });
			expect(screen.getByLabelText("Open File Explorer")).toBeInTheDocument();
		});

		it("keeps only the summary pill inline and hides other session details by default", () => {
			renderAppHeader({
				backendLabel: "Claude Agent",
				workspaceLabel: "mobvibe",
				workspacePath: "/Users/eric/src/mobvibe",
				executionMode: "worktree",
				branchLabel: "feat/detection-fix",
				subdirectoryLabel: "apps/webui",
			});

			expect(screen.getByText("mobvibe")).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: "Session Details" }),
			).toBeInTheDocument();
			expect(screen.queryByText("Claude Agent")).not.toBeInTheDocument();
			expect(screen.queryByText("feat/detection-fix")).not.toBeInTheDocument();
			expect(screen.queryByText("apps/webui")).not.toBeInTheDocument();
		});

		it("hides the details trigger when no extra metadata exists", () => {
			renderAppHeader({ backendLabel: "Claude Agent" });
			expect(
				screen.queryByRole("button", { name: "Session Details" }),
			).not.toBeInTheDocument();
		});

		it("shows the details trigger when context left is the only detail", () => {
			renderAppHeader({
				backendLabel: "Claude Agent",
				contextLeftPercent: 74,
			});

			expect(
				screen.getByRole("button", { name: "Session Details" }),
			).toBeInTheDocument();
		});

		it("opens a desktop popover with session details", async () => {
			const user = userEvent.setup();
			renderAppHeader({
				backendLabel: "Claude Agent",
				workspaceLabel: "mobvibe",
				workspacePath: "/Users/eric/src/mobvibe",
				executionMode: "worktree",
				branchLabel: "feat/detection-fix",
				subdirectoryLabel: "apps/webui",
				contextLeftPercent: 74,
			});

			await user.click(screen.getByRole("button", { name: "Session Details" }));

			expect(screen.getByTestId("popover-content")).toBeInTheDocument();
			expect(screen.getByText("Workspace Path")).toBeInTheDocument();
			expect(screen.getByText("/Users/eric/src/mobvibe")).toBeInTheDocument();
			expect(screen.getByText("Execution Mode")).toBeInTheDocument();
			expect(screen.getByText("Worktree")).toBeInTheDocument();
			expect(screen.getByText("Branch")).toBeInTheDocument();
			expect(screen.getByText("feat/detection-fix")).toBeInTheDocument();
			expect(screen.getByText("Subdirectory")).toBeInTheDocument();
			expect(screen.getByText("apps/webui")).toBeInTheDocument();
			expect(screen.getByText("Context Left")).toBeInTheDocument();
			expect(screen.getByText("74%")).toBeInTheDocument();
		});

		it("opens a mobile sheet with session details", async () => {
			mockUseIsMobile.mockReturnValue(true);
			const user = userEvent.setup();
			renderAppHeader({
				backendLabel: "Claude Agent",
				workspaceLabel: "mobvibe",
				workspacePath: "/Users/eric/src/mobvibe",
				executionMode: "worktree",
				branchLabel: "feat/detection-fix",
				subdirectoryLabel: "apps/webui",
				contextLeftPercent: 74,
			});

			await user.click(screen.getByRole("button", { name: "Session Details" }));

			expect(screen.getByTestId("sheet-content")).toBeInTheDocument();
			expect(screen.getByTestId("sheet-title")).toHaveTextContent(
				"Session Details",
			);
			expect(screen.getByText("Context Left")).toBeInTheDocument();
			expect(screen.getByText("74%")).toBeInTheDocument();
			expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();
		});

		it("does not render a context-left row when the prop is absent", async () => {
			const user = userEvent.setup();
			renderAppHeader({
				backendLabel: "Claude Agent",
				workspaceLabel: "mobvibe",
				workspacePath: "/Users/eric/src/mobvibe",
			});

			await user.click(screen.getByRole("button", { name: "Session Details" }));

			expect(screen.queryByText("Context Left")).not.toBeInTheDocument();
			expect(screen.queryByText("74%")).not.toBeInTheDocument();
		});

		it("uses a single-line truncating metadata strip", () => {
			renderAppHeader({
				workspaceLabel: "mobvibe",
				workspacePath: "/Users/eric/src/mobvibe",
			});

			expect(screen.getByTestId("session-header-meta")).toHaveClass(
				"overflow-hidden",
			);
			expect(screen.getByTestId("session-header-summary")).toHaveClass(
				"truncate",
			);
		});
	});

	describe("Status Messages", () => {
		it("displays loading message when provided", () => {
			renderAppHeader({ loadingMessage: "Loading..." });
			expect(screen.getByText("Loading...")).toBeInTheDocument();
		});

		it("displays warning message when provided", () => {
			renderAppHeader({
				warningMessage: "History may be out of date. Try syncing again.",
			});
			expect(
				screen.getByText("History may be out of date. Try syncing again."),
			).toBeInTheDocument();
		});

		it("displays status message when provided", () => {
			renderAppHeader({ statusMessage: "Status: Active" });
			expect(screen.getByText("Status: Active")).toBeInTheDocument();
		});

		it("displays stream error when provided", () => {
			const streamError = {
				message: "Connection lost",
				code: "STREAM_DISCONNECTED" as const,
				retryable: true,
				scope: "stream" as const,
			};
			renderAppHeader({ streamError });
			expect(screen.getByText("Connection lost")).toBeInTheDocument();
		});
	});
});
