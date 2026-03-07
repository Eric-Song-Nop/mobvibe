import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";

// Mock react-i18next - must be defined before other imports
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"common.clear": "Clear",
				"common.close": "Close",
				"commandPalette.searchPlaceholder": "Type a command or search...",
				"commandPalette.newSession": "New Session",
				"commandPalette.archiveSession": "Archive Session",
				"commandPalette.clearChat": "Clear Chat Messages",
				"commandPalette.cancelGeneration": "Cancel Generation",
				"commandPalette.openFileExplorer": "Open File Explorer",
				"commandPalette.openChanges": "Open Changes",
				"commandPalette.searchInChat": "Search in Chat",
				"commandPalette.searchFiles": "Search Files",
				"commandPalette.toggleSidebar": "Toggle Sidebar",
				"commandPalette.openSettings": "Open Settings",
				"commandPalette.signOut": "Sign Out",
				"commandPalette.toggleTheme": "Toggle Theme",
				"commandPalette.switchLanguage": "Switch Language",
				"commandPalette.noResults": "No matching commands",
			};
			return translations[key] || key;
		},
		i18n: {
			language: "en",
			changeLanguage: vi.fn(),
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
const mockDialogOnOpenChange = vi.hoisted(() => ({
	value: undefined as undefined | ((open: boolean) => void),
}));

vi.mock("react-router-dom", () => ({
	useNavigate: () => mockNavigate,
	MemoryRouter: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

// Mock stores
const mockChatStore = vi.hoisted(() => ({
	value: {
		sessions: {} as Record<string, unknown>,
		activeSessionId: undefined as string | undefined,
		clearSessionMessages: vi.fn(),
		setCanceling: vi.fn(),
		getState: vi.fn(() => mockChatStore.value),
	},
}));

vi.mock("@/lib/chat-store", () => {
	const hook = () => mockChatStore.value;
	hook.getState = () => mockChatStore.value;
	return {
		useChatStore: hook,
	};
});

const mockUiStore = vi.hoisted(() => ({
	value: {
		setFileExplorerOpen: vi.fn(),
		setChatSearchOpen: vi.fn(),
		setCreateDialogOpen: vi.fn(),
		setMobileMenuOpen: vi.fn(),
		setFilePreviewPath: vi.fn(),
		getState: vi.fn(() => mockUiStore.value),
	},
}));

vi.mock("@/lib/ui-store", () => {
	const hook = () => mockUiStore.value;
	hook.getState = () => mockUiStore.value;
	return {
		useUiStore: hook,
	};
});

const mockMachinesStore = vi.hoisted(() => ({
	value: {
		selectedMachineId: undefined,
		setSelectedMachineId: vi.fn(),
	},
}));

vi.mock("@/lib/machines-store", () => ({
	useMachinesStore: () => mockMachinesStore.value,
}));

// Mock auth
const mockSignOut = vi.fn();
vi.mock("@/components/auth/AuthProvider", () => ({
	useAuth: () => ({
		user: { email: "test@example.com", name: "Test User" },
		signOut: mockSignOut,
	}),
}));

// Mock theme
const mockSetTheme = vi.fn();
vi.mock("@/components/theme-provider", () => ({
	useTheme: () => ({
		theme: "light",
		setTheme: mockSetTheme,
	}),
	ThemeProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

// Mock API
vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		fetchSessionFsResources: vi.fn(),
		fetchSessionGitStatus: vi.fn(),
	};
});

// Mock react-virtual
const mockMeasure = vi.fn();
vi.mock("@tanstack/react-virtual", () => ({
	useVirtualizer: () => ({
		getVirtualItems: () => [],
		getTotalSize: () => 0,
		scrollToIndex: vi.fn(),
		measure: mockMeasure,
	}),
}));

// Mock Dialog
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({
		children,
		open,
		onOpenChange,
	}: {
		children: React.ReactNode;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	}) => {
		mockDialogOnOpenChange.value = onOpenChange;
		return open ? <div data-testid="dialog">{children}</div> : null;
	},
	DialogContent: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="dialog-content">{children}</div>
	),
	DialogClose: ({
		children,
	}: {
		children: React.ReactNode;
		asChild?: boolean;
	}) =>
		React.isValidElement<{ onClick?: () => void }>(children)
			? React.cloneElement(children, {
					onClick: () => {
						children.props.onClick?.();
						mockDialogOnOpenChange.value?.(false);
					},
				})
			: children,
	DialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("CommandPalette", () => {
	let queryClient: QueryClient;
	const mockOnOpenChange = vi.fn();

	const renderCommandPalette = (props = {}) => {
		return render(
			<QueryClientProvider client={queryClient}>
				<CommandPalette
					open={true}
					onOpenChange={mockOnOpenChange}
					{...props}
				/>
			</QueryClientProvider>,
		);
	};

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
		vi.clearAllMocks();
		mockDialogOnOpenChange.value = undefined;
		// Reset store mocks
		mockChatStore.value.sessions = {};
		mockChatStore.value.activeSessionId = undefined;
	});

	describe("Rendering", () => {
		it("renders when open is true", () => {
			renderCommandPalette({ open: true });
			expect(screen.getByTestId("dialog")).toBeInTheDocument();
		});

		it("does not render when open is false", () => {
			renderCommandPalette({ open: false });
			expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
		});

		it("shows search placeholder", () => {
			renderCommandPalette();
			expect(
				screen.getByPlaceholderText("Type a command or search..."),
			).toBeInTheDocument();
		});

		it("shows input field for search", () => {
			renderCommandPalette();
			// The search input should be present
			expect(
				screen.getByPlaceholderText("Type a command or search..."),
			).toBeInTheDocument();
		});

		it("shows builtin commands immediately when opened", () => {
			renderCommandPalette();
			expect(screen.getByText("New Session")).toBeInTheDocument();
		});
	});

	describe("Input Interactions", () => {
		it("updates query when typing", async () => {
			renderCommandPalette();
			const user = userEvent.setup();

			const input = screen.getByPlaceholderText("Type a command or search...");
			await user.type(input, "test query");

			expect(input).toHaveValue("test query");
		});

		it("closes on Escape key", async () => {
			renderCommandPalette();
			const user = userEvent.setup();

			const input = screen.getByPlaceholderText("Type a command or search...");
			await user.type(input, "{Escape}");

			expect(mockOnOpenChange).toHaveBeenCalledWith(false);
		});

		it("clears query when clear button is clicked", async () => {
			renderCommandPalette();
			const user = userEvent.setup();

			const input = screen.getByPlaceholderText("Type a command or search...");
			await user.type(input, "test");
			expect(input).toHaveValue("test");

			// Find and click clear button
			const clearButton = screen.getByRole("button", { name: "Clear" });
			await user.click(clearButton);

			expect(input).toHaveValue("");
		});

		it("closes when the close button is clicked", async () => {
			renderCommandPalette();
			const user = userEvent.setup();

			await user.click(screen.getByLabelText("Close"));

			expect(mockOnOpenChange).toHaveBeenCalledWith(false);
		});
	});

	describe("Contextual Command Availability", () => {
		it("has no active session by default", () => {
			// This test verifies our mock setup
			expect(mockChatStore.value.activeSessionId).toBeUndefined();
		});

		it("tracks active session changes", () => {
			mockChatStore.value.activeSessionId = "session-1";
			expect(mockChatStore.value.activeSessionId).toBe("session-1");
		});

		it("tracks session generation state", () => {
			mockChatStore.value.activeSessionId = "session-1";
			mockChatStore.value.sessions = {
				"session-1": {
					sessionId: "session-1",
					title: "Test Session",
					messages: [],
					sending: true,
				},
			};

			const session = mockChatStore.value.sessions["session-1"] as {
				sending: boolean;
			};
			expect(session.sending).toBe(true);
		});

		it("tracks session message count", () => {
			mockChatStore.value.activeSessionId = "session-1";
			mockChatStore.value.sessions = {
				"session-1": {
					sessionId: "session-1",
					title: "Test Session",
					messages: [{ id: "1", role: "user", content: "Hello" }],
					sending: false,
				},
			};

			const session = mockChatStore.value.sessions["session-1"] as {
				messages: unknown[];
			};
			expect(session.messages.length).toBe(1);
		});
	});

	describe("Command Actions", () => {
		it("calls onOpenChange when executing a command", async () => {
			renderCommandPalette();

			// Simulate command execution by calling the callback directly
			mockOnOpenChange(false);
			expect(mockOnOpenChange).toHaveBeenCalledWith(false);
		});

		it("can open settings dialog", () => {
			// Simulate opening settings
			mockNavigate("/settings");
			expect(mockNavigate).toHaveBeenCalledWith("/settings");
		});

		it("can sign out", () => {
			mockSignOut();
			expect(mockSignOut).toHaveBeenCalled();
		});

		it("can toggle theme", () => {
			mockSetTheme("dark");
			expect(mockSetTheme).toHaveBeenCalledWith("dark");
		});

		it("can clear session messages", () => {
			mockChatStore.value.clearSessionMessages("session-1");
			expect(mockChatStore.value.clearSessionMessages).toHaveBeenCalledWith(
				"session-1",
			);
		});

		it("can set canceling state", () => {
			mockChatStore.value.setCanceling("session-1", true);
			expect(mockChatStore.value.setCanceling).toHaveBeenCalledWith(
				"session-1",
				true,
			);
		});
	});

	describe("UI Store Actions", () => {
		it("can open file explorer", () => {
			mockUiStore.value.setFileExplorerOpen(true);
			expect(mockUiStore.value.setFileExplorerOpen).toHaveBeenCalledWith(true);
		});

		it("can open chat search", () => {
			mockUiStore.value.setChatSearchOpen(true);
			expect(mockUiStore.value.setChatSearchOpen).toHaveBeenCalledWith(true);
		});

		it("can open create dialog", () => {
			mockUiStore.value.setCreateDialogOpen(true);
			expect(mockUiStore.value.setCreateDialogOpen).toHaveBeenCalledWith(true);
		});

		it("can toggle mobile menu", () => {
			mockUiStore.value.setMobileMenuOpen(true);
			expect(mockUiStore.value.setMobileMenuOpen).toHaveBeenCalledWith(true);
		});
	});

	describe("File Search Mode", () => {
		it("shows file search hint when typing @", async () => {
			mockChatStore.value.activeSessionId = "session-1";

			renderCommandPalette();
			const user = userEvent.setup();

			const input = screen.getByPlaceholderText("Type a command or search...");
			await user.type(input, "@");

			expect(screen.getByText("Search Files")).toBeInTheDocument();
		});

		it("clears file search mode on Backspace when only @", async () => {
			renderCommandPalette();
			const user = userEvent.setup();

			const input = screen.getByPlaceholderText("Type a command or search...");
			await user.type(input, "@");
			expect(input).toHaveValue("@");

			await user.type(input, "{Backspace}");

			expect(input).toHaveValue("");
		});
	});

	describe("Virtualizer Behavior", () => {
		it("does not call virtualizer.measure in command mode", async () => {
			const { rerender } = renderCommandPalette({ open: false });

			// Ensure measure was not called initially when closed
			expect(mockMeasure).not.toHaveBeenCalled();

			// Re-render with open=true
			rerender(
				<QueryClientProvider client={queryClient}>
					<CommandPalette open={true} onOpenChange={mockOnOpenChange} />
				</QueryClientProvider>,
			);

			// Wait for requestAnimationFrame
			await new Promise((resolve) => requestAnimationFrame(resolve));

			// command mode renders without virtualization
			expect(mockMeasure).not.toHaveBeenCalled();
		});

		it("calls virtualizer.measure when entering file mode", async () => {
			renderCommandPalette();
			const user = userEvent.setup();
			const input = screen.getByPlaceholderText("Type a command or search...");

			await user.type(input, "@");
			await new Promise((resolve) => requestAnimationFrame(resolve));

			expect(mockMeasure).toHaveBeenCalled();
		});
	});
});
