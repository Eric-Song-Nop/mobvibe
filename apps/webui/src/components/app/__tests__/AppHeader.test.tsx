import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { AppHeader } from "../AppHeader";

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"commandPalette.openCommandPalette": "Open Command Palette",
				"common.toggleMenu": "Toggle menu",
				"session.syncHistory": "Sync History",
				"session.forceReloadTitle": "Force Reload",
				"session.forceReloadDescription": "This will force reload the session.",
				"session.forceReloadConfirm": "Reload",
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

// Mock AlertDialog
vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({
		children,
		open,
	}: {
		children: React.ReactNode;
		open?: boolean;
	}) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
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
	AlertDialogTrigger: ({
		children,
		asChild,
	}: {
		children: React.ReactNode;
		asChild?: boolean;
	}) => <div data-testid="alert-dialog-trigger">{children}</div>,
}));

// Mock Badge
vi.mock("@/components/ui/badge", () => ({
	Badge: ({
		children,
		variant,
	}: {
		children: React.ReactNode;
		variant?: string;
	}) => (
		<span data-testid="badge" data-variant={variant}>
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
			expect(screen.getByTestId("badge")).toHaveTextContent("Test Backend");
		});

		it("shows plan indicator when plan is provided", () => {
			renderAppHeader({ plan: [{ name: "test-step" }] });
			expect(screen.getByTestId("plan-indicator")).toBeInTheDocument();
		});

		it("shows sync history button when enabled", () => {
			renderAppHeader({ showSyncHistory: true });
			expect(screen.getByLabelText("Sync History")).toBeInTheDocument();
		});

		it("shows file explorer button when enabled", () => {
			renderAppHeader({ showFileExplorer: true });
			expect(screen.getByLabelText("Open File Explorer")).toBeInTheDocument();
		});
	});

	describe("Status Messages", () => {
		it("displays loading message when provided", () => {
			renderAppHeader({ loadingMessage: "Loading..." });
			expect(screen.getByText("Loading...")).toBeInTheDocument();
		});

		it("displays status message when provided", () => {
			renderAppHeader({ statusMessage: "Status: Active" });
			expect(screen.getByText("Status: Active")).toBeInTheDocument();
		});

		it("displays stream error when provided", () => {
			const streamError = { message: "Connection lost", code: "ERR" };
			renderAppHeader({ streamError });
			expect(screen.getByText("Connection lost")).toBeInTheDocument();
		});
	});
});
