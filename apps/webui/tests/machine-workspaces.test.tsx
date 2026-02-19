import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/lib/chat-store";
import { MachineWorkspaces } from "../src/components/machines/MachineWorkspaces";
import { useMachinesStore } from "../src/lib/machines-store";
import { useUiStore } from "../src/lib/ui-store";

// Mock the API module so useQueries calls resolve/reject as we control
vi.mock("../src/lib/api", async () => {
	const actual =
		await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
	return {
		...actual,
		fetchFsEntries: vi.fn(),
	};
});

// Mock discoverSessions to prevent real network calls
vi.mock("../src/hooks/useSessionQueries", () => ({
	useDiscoverSessionsMutation: () => ({ mutate: vi.fn() }),
}));

import { fetchFsEntries } from "../src/lib/api";

const MACHINE_ID = "machine-1";

const buildSession = (
	sessionId: string,
	cwd: string,
	overrides?: Record<string, unknown>,
) => ({
	sessionId,
	title: `Session ${sessionId}`,
	machineId: MACHINE_ID,
	cwd,
	input: "",
	inputContents: [{ type: "text" as const, text: "" }],
	messages: [],
	terminalOutputs: {},
	sending: false,
	canceling: false,
	isLoading: false,
	createdAt: "2025-01-01T00:00:00Z",
	updatedAt: "2025-01-01T00:00:00Z",
	...overrides,
});

let queryClient: QueryClient;

const Wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	// Set up machine as connected and expanded
	useMachinesStore.setState({
		machines: {
			[MACHINE_ID]: {
				machineId: MACHINE_ID,
				hostname: "test-host",
				connected: true,
			},
		},
		selectedMachineId: MACHINE_ID,
	});

	// Clear UI store
	useUiStore.setState({
		selectedWorkspaceByMachine: {},
		expandedMachines: { [MACHINE_ID]: true },
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
	});
	useMachinesStore.setState({
		machines: {},
		selectedMachineId: null,
	});
	useUiStore.setState({
		selectedWorkspaceByMachine: {},
		expandedMachines: {},
	});
});

describe("MachineWorkspaces validation effect", () => {
	it("selects valid fallback when selected workspace CWD becomes invalid", async () => {
		const validCwd = "/home/user/valid-project";
		const invalidCwd = "/home/user/deleted-project";

		// Two sessions with different CWDs
		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", validCwd),
				"s-2": buildSession("s-2", invalidCwd),
			},
		});

		// Select the invalid workspace
		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: invalidCwd },
		});

		// fetchFsEntries: valid project succeeds, deleted project fails
		vi.mocked(fetchFsEntries).mockImplementation(async (payload) => {
			if (payload.path === validCwd) {
				return { entries: [] };
			}
			throw new Error("ENOENT: no such file or directory");
		});

		render(
			<Wrapper>
				<MachineWorkspaces machineId={MACHINE_ID} isExpanded />
			</Wrapper>,
		);

		// Wait for validation queries to settle and the effect to fire
		await waitFor(() => {
			const state = useUiStore.getState();
			expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(validCwd);
		});
	});

	it("does not clear to undefined when no valid fallback exists", async () => {
		const invalidCwd = "/home/user/deleted-project";

		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", invalidCwd),
			},
		});

		// Select the invalid workspace
		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: invalidCwd },
		});

		// All workspaces fail validation
		vi.mocked(fetchFsEntries).mockRejectedValue(
			new Error("ENOENT: no such file or directory"),
		);

		render(
			<Wrapper>
				<MachineWorkspaces machineId={MACHINE_ID} isExpanded />
			</Wrapper>,
		);

		// Wait for queries to settle
		await waitFor(() => {
			const fetched = vi.mocked(fetchFsEntries).mock.calls.length > 0;
			expect(fetched).toBe(true);
		});

		// The workspace should NOT be cleared to undefined (which would cause oscillation)
		const state = useUiStore.getState();
		expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(invalidCwd);
	});

	it("leaves selection unchanged when the CWD is valid", async () => {
		const validCwd = "/home/user/valid-project";

		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", validCwd),
			},
		});

		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: validCwd },
		});

		vi.mocked(fetchFsEntries).mockResolvedValue({ entries: [] });

		render(
			<Wrapper>
				<MachineWorkspaces machineId={MACHINE_ID} isExpanded />
			</Wrapper>,
		);

		// Wait for validation to complete
		await waitFor(() => {
			const fetched = vi.mocked(fetchFsEntries).mock.calls.length > 0;
			expect(fetched).toBe(true);
		});

		// Selection should remain the valid CWD
		const state = useUiStore.getState();
		expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(validCwd);
	});

	it("renders nothing when not expanded", () => {
		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", "/home/user/project"),
			},
		});

		const { container } = render(
			<Wrapper>
				<MachineWorkspaces machineId={MACHINE_ID} isExpanded={false} />
			</Wrapper>,
		);

		expect(container.innerHTML).toBe("");
	});

	it("selects fallback when workspace is removed from session list", async () => {
		const cwdA = "/home/user/project-a";
		const cwdB = "/home/user/project-b";

		// Only project-a has sessions; project-b was previously selected but
		// its sessions have been removed
		useChatStore.setState({
			sessions: {
				"s-1": buildSession("s-1", cwdA),
			},
		});

		useUiStore.setState({
			selectedWorkspaceByMachine: { [MACHINE_ID]: cwdB },
		});

		vi.mocked(fetchFsEntries).mockResolvedValue({ entries: [] });

		render(
			<Wrapper>
				<MachineWorkspaces machineId={MACHINE_ID} isExpanded />
			</Wrapper>,
		);

		// cwdB is not in workspaceList (no sessions for it), so the effect
		// should pick cwdA as the fallback
		await waitFor(() => {
			const state = useUiStore.getState();
			expect(state.selectedWorkspaceByMachine[MACHINE_ID]).toBe(cwdA);
		});
	});
});
