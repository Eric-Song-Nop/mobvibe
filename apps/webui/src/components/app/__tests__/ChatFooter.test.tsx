import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@/lib/chat-store";
import { createDefaultContentBlocks } from "@/lib/content-block-utils";
import { useUiStore } from "@/lib/ui-store";
import { ChatFooter } from "../ChatFooter";

vi.mock("@hugeicons/react", () => ({
	HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
	ArrowUp01Icon: {},
	StopIcon: {},
	File01Icon: {},
}));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string, options?: Record<string, string>) =>
				options?.value ? `${key}:${options.value}` : key,
		}),
	};
});

vi.mock("@/hooks/use-mobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({
		children,
		size: _size,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({
		children,
		size: _size,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => (
		<>{placeholder}</>
	),
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
		<div data-value={value}>{children}</div>
	),
}));

const fetchSessionFsResources = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		fetchSessionFsResources: fetchSessionFsResources,
	};
});

const buildSession = (overrides: Partial<ChatSession> = {}): ChatSession =>
	({
		sessionId: "session-1",
		title: "Session 1",
		input: "",
		inputContents: createDefaultContentBlocks(""),
		messages: [],
		terminalOutputs: {},
		sending: false,
		canceling: false,
		isAttached: true,
		isLoading: false,
		e2eeStatus: "none",
		cwd: "/repo",
		availableCommands: [],
		availableModels: [],
		availableModes: [],
		...overrides,
	}) as ChatSession;

const renderFooter = (
	session: ChatSession,
	props?: Partial<ComponentProps<typeof ChatFooter>>,
) => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<ChatFooter
				activeSession={session}
				activeSessionId={session.sessionId}
				isModeSwitching={false}
				isModelSwitching={false}
				onModeChange={vi.fn()}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onCancel={vi.fn()}
				{...props}
			/>
		</QueryClientProvider>,
	);
};

const setEditorValue = (editor: HTMLElement, text: string) => {
	editor.focus();
	editor.textContent = text;
	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(editor);
	range.collapse(false);
	selection?.removeAllRanges();
	selection?.addRange(range);
	fireEvent.input(editor);
};

describe("ChatFooter", () => {
	beforeEach(() => {
		useUiStore.setState({ chatDrafts: {} });
		fetchSessionFsResources.mockResolvedValue({
			rootPath: "/repo",
			entries: [],
		});
		HTMLElement.prototype.scrollIntoView = vi.fn();
	});

	it("populates the composer when selecting a slash command", async () => {
		const user = userEvent.setup();
		const session = buildSession({
			availableCommands: [
				{
					name: "open",
					description: "Open a file",
				},
			],
		});

		renderFooter(session);

		const editor = screen.getByRole("textbox", { name: "chat.placeholder" });
		setEditorValue(editor, "/");

		const commandOption = await screen.findByRole("option", {
			name: /\/open/i,
		});
		await user.click(commandOption);

		await waitFor(() => {
			expect(useUiStore.getState().chatDrafts[session.sessionId]).toEqual({
				input: "/open",
				inputContents: createDefaultContentBlocks("/open"),
			});
		});
		expect(editor).toHaveTextContent("/open");
	});

	it("inserts a resource token when selecting a file mention", async () => {
		const user = userEvent.setup();
		const session = buildSession();
		fetchSessionFsResources.mockResolvedValue({
			rootPath: "/repo",
			entries: [
				{
					name: "README.md",
					path: "/repo/README.md",
					relativePath: "README.md",
					type: "file",
				},
			],
		});

		renderFooter(session);

		await waitFor(() => {
			expect(fetchSessionFsResources).toHaveBeenCalledWith({
				sessionId: session.sessionId,
			});
		});

		const editor = screen.getByRole("textbox", { name: "chat.placeholder" });
		setEditorValue(editor, "@");

		const resourceOption = await screen.findByRole("option", {
			name: /README\.md/i,
		});
		await user.click(resourceOption);

		await waitFor(() => {
			const draft = useUiStore.getState().chatDrafts[session.sessionId];
			expect(draft?.input).toBe("@README.md");
			expect(draft?.inputContents).toEqual(
				expect.arrayContaining([
					{
						type: "resource_link",
						uri: "file:///repo/README.md",
						name: "README.md",
					},
				]),
			);
		});

		expect(
			within(editor).getByRole("button", { name: "@README.md" }),
		).toBeInTheDocument();
	});

	it("enables send for resource-only drafts", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const session = buildSession();

		useUiStore.getState().setChatDraft(session.sessionId, {
			input: "",
			inputContents: [
				{
					type: "resource_link",
					uri: "file:///repo/README.md",
					name: "README.md",
				},
			],
		});

		renderFooter(session, { onSend });

		const sendButton = screen.getByRole("button", { name: "chat.send" });
		expect(sendButton).toBeEnabled();

		await user.click(sendButton);

		expect(onSend).toHaveBeenCalledOnce();
	});

	it("keeps send disabled until restored session E2EE status is hydrated", () => {
		const session = buildSession({
			e2eeStatus: undefined,
		});

		useUiStore.getState().setChatDraft(session.sessionId, {
			input: "Top secret prompt",
			inputContents: createDefaultContentBlocks("Top secret prompt"),
		});

		renderFooter(session);

		expect(screen.getByRole("button", { name: "chat.send" })).toBeDisabled();
	});
});
