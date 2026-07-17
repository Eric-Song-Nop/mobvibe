import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAuthenticationPanel } from "../AgentAuthenticationPanel";

const mockUseAgentAuthentication = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAgentAuthentication", () => ({
	useAgentAuthentication: mockUseAgentAuthentication,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, string>) => {
			const translations: Record<string, string> = {
				"common.cancel": "Cancel",
				"common.retry": "Try again",
				"session.agentAuthentication.actionError":
					"The Agent authentication request failed or timed out.",
				"session.agentAuthentication.authenticate": `Authenticate with ${options?.name ?? ""}`,
				"session.agentAuthentication.authenticateComplete":
					"The Agent authentication flow completed. Capabilities were refreshed.",
				"session.agentAuthentication.authenticating":
					"Starting Agent authentication…",
				"session.agentAuthentication.checking":
					"Checking Agent authentication options…",
				"session.agentAuthentication.description":
					"Authentication is handled by the Agent. Mobvibe never receives your credentials and does not track sign-in status.",
				"session.agentAuthentication.loadError":
					"Couldn’t load the Agent’s authentication options.",
				"session.agentAuthentication.loggingOut": "Sending sign-out request…",
				"session.agentAuthentication.logout": "Sign out from Agent",
				"session.agentAuthentication.logoutComplete":
					"The Agent sign-out request completed. Capabilities were refreshed.",
				"session.agentAuthentication.logoutConfirm": "Sign out from Agent",
				"session.agentAuthentication.logoutDescription":
					"This asks the selected Agent backend to end its authentication state.",
				"session.agentAuthentication.logoutImpact":
					"Signing out asks the Agent to end its authentication state.",
				"session.agentAuthentication.logoutTitle":
					"End the Agent authentication state?",
				"session.agentAuthentication.title": "Agent authentication",
			};
			return translations[key] ?? key;
		},
	}),
}));

vi.mock("@mobvibe/ui/alert-dialog", () => ({
	AlertDialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
		open ? <div data-testid="logout-confirmation">{children}</div> : null,
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
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));

const createHookResult = (
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	actionError: undefined,
	actionKind: undefined,
	actionMethodId: undefined,
	actionSucceeded: false,
	authenticate: vi.fn(),
	capabilities: undefined,
	capabilitiesQuery: {
		isError: false,
		isFetching: false,
		isPending: false,
		refetch: vi.fn(),
	},
	isActionPending: false,
	logout: vi.fn(),
	...overrides,
});

describe("AgentAuthenticationPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("hides when the Agent advertises no stable authentication action", () => {
		mockUseAgentAuthentication.mockReturnValue(createHookResult());

		const { container } = render(
			<AgentAuthenticationPanel
				backendId="backend-1"
				enabled
				machineId="machine-1"
			/>,
		);

		expect(container).toBeEmptyDOMElement();
	});

	it("shows only Agent-managed methods and never renders credential inputs", () => {
		const authenticate = vi.fn();
		mockUseAgentAuthentication.mockReturnValue(
			createHookResult({
				authenticate,
				capabilities: {
					logout: false,
					methods: [
						{
							description: "Opens the Agent’s browser flow",
							id: "browser",
							name: "Browser login",
						},
					],
				},
			}),
		);

		render(
			<AgentAuthenticationPanel
				backendId="backend-1"
				enabled
				machineId="machine-1"
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Agent authentication" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Mobvibe never receives your credentials/),
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: /Authenticate with Browser login/ }),
		);
		expect(authenticate).toHaveBeenCalledWith("browser");
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		expect(document.querySelector('input[type="password"]')).toBeNull();
	});

	it("announces loading and offers an explicit retry after a query failure", () => {
		const refetch = vi.fn();
		mockUseAgentAuthentication.mockReturnValue(
			createHookResult({
				capabilitiesQuery: {
					isError: true,
					isFetching: false,
					isPending: false,
					refetch,
				},
			}),
		);

		const { rerender } = render(
			<AgentAuthenticationPanel
				backendId="backend-1"
				enabled
				machineId="machine-1"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(refetch).toHaveBeenCalledTimes(1);

		mockUseAgentAuthentication.mockReturnValue(
			createHookResult({
				capabilitiesQuery: {
					isError: false,
					isFetching: true,
					isPending: true,
					refetch,
				},
			}),
		);
		rerender(
			<AgentAuthenticationPanel
				backendId="backend-1"
				enabled
				machineId="machine-1"
			/>,
		);
		expect(screen.getByRole("status")).toHaveTextContent(
			"Checking Agent authentication options…",
		);
	});

	it("explains and confirms that logout ends the Agent authentication state", () => {
		const logout = vi.fn();
		mockUseAgentAuthentication.mockReturnValue(
			createHookResult({
				capabilities: { logout: true, methods: [] },
				logout,
			}),
		);

		render(
			<AgentAuthenticationPanel
				backendId="backend-1"
				enabled
				machineId="machine-1"
			/>,
		);
		expect(
			screen.getByText(
				"Signing out asks the Agent to end its authentication state.",
			),
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "Sign out from Agent" }),
		);
		expect(screen.getByTestId("logout-confirmation")).toBeInTheDocument();
		expect(
			screen.getByText(
				"This asks the selected Agent backend to end its authentication state.",
			),
		).toBeInTheDocument();
		const signOutButtons = screen.getAllByRole("button", {
			name: "Sign out from Agent",
		});
		fireEvent.click(signOutButtons.at(-1)!);
		expect(logout).toHaveBeenCalledTimes(1);
	});
});
