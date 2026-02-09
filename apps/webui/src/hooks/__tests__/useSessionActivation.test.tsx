import type { ChatSession } from "@mobvibe/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionActivation } from "../useSessionActivation";
import type { ChatStoreActions } from "../useSessionMutations";

let machinesState: {
	machines: Record<string, { capabilities?: { list: boolean; load: boolean } }>;
};

vi.mock("@/lib/machines-store", () => ({
	useMachinesStore: (selector: (state: typeof machinesState) => unknown) =>
		selector(machinesState),
}));

const mockGatewaySocket = vi.hoisted(() => ({
	subscribeToSession: vi.fn(),
	unsubscribeFromSession: vi.fn(),
}));

vi.mock("@/lib/socket", () => ({
	gatewaySocket: mockGatewaySocket,
}));

const loadSessionMutation = {
	mutateAsync: vi.fn(),
};
const reloadSessionMutation = {
	mutateAsync: vi.fn(),
};

vi.mock("../useSessionMutations", () => ({
	useSessionMutations: () => ({
		loadSessionMutation,
		reloadSessionMutation,
	}),
}));

const buildSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
	sessionId: "session-1",
	title: "Session 1",
	input: "",
	inputContents: [],
	messages: [],
	terminalOutputs: {},
	sending: false,
	canceling: false,
	isAttached: false,
	isLoading: false,
	...overrides,
});

const createStore = (): ChatStoreActions =>
	({
		sessions: {},
		setActiveSessionId: vi.fn(),
		setLastCreatedCwd: vi.fn(),
		setSessionLoading: vi.fn(),
		markSessionAttached: vi.fn(),
		markSessionDetached: vi.fn(),
		createLocalSession: vi.fn(),
		syncSessions: vi.fn(),
		removeSession: vi.fn(),
		renameSession: vi.fn(),
		setError: vi.fn(),
		setAppError: vi.fn(),
		setInput: vi.fn(),
		setInputContents: vi.fn(),
		setSending: vi.fn(),
		setCanceling: vi.fn(),
		setStreamError: vi.fn(),
		updateSessionMeta: vi.fn(),
		addUserMessage: vi.fn(),
		addStatusMessage: vi.fn(),
		appendAssistantChunk: vi.fn(),
		appendThoughtChunk: vi.fn(),
		appendUserChunk: vi.fn(),
		finalizeAssistantMessage: vi.fn(),
		addPermissionRequest: vi.fn(),
		setPermissionDecisionState: vi.fn(),
		setPermissionOutcome: vi.fn(),
		addToolCall: vi.fn(),
		updateToolCall: vi.fn(),
		appendTerminalOutput: vi.fn(),
		handleSessionsChanged: vi.fn(),
		clearSessionMessages: vi.fn(),
		restoreSessionMessages: vi.fn(),
	}) as unknown as ChatStoreActions;

describe("useSessionActivation", () => {
	beforeEach(() => {
		machinesState = { machines: {} };
		loadSessionMutation.mutateAsync.mockReset();
		reloadSessionMutation.mutateAsync.mockReset();
		mockGatewaySocket.subscribeToSession.mockReset();
		mockGatewaySocket.unsubscribeFromSession.mockReset();
	});

	it("activates attached session without loading", async () => {
		const store = createStore();
		const session = buildSession({
			isAttached: true,
		});

		const { result } = renderHook(() => useSessionActivation(store));

		await act(async () => {
			await result.current.activateSession(session);
		});

		expect(store.setActiveSessionId).toHaveBeenCalledWith("session-1");
		expect(loadSessionMutation.mutateAsync).not.toHaveBeenCalled();
	});

	it("does nothing when session is already loading", async () => {
		const store = createStore();
		const session = buildSession({
			isLoading: true,
			cwd: "/home/user/project",
			machineId: "machine-1",
		});

		machinesState = {
			machines: { "machine-1": { capabilities: { list: true, load: true } } },
		};

		const { result } = renderHook(() => useSessionActivation(store));

		await act(async () => {
			await result.current.activateSession(session);
		});

		expect(loadSessionMutation.mutateAsync).not.toHaveBeenCalled();
		expect(store.setActiveSessionId).not.toHaveBeenCalled();
	});

	it("sets error when load capability is missing", async () => {
		const store = createStore();
		const session = buildSession({
			cwd: "/home/user/project",
			machineId: "machine-1",
		});

		machinesState = {
			machines: { "machine-1": { capabilities: { list: true, load: false } } },
		};

		const { result } = renderHook(() => useSessionActivation(store));

		await act(async () => {
			await result.current.activateSession(session);
		});

		expect(store.setError).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({
				message: "Agent does not support session/load",
			}),
		);
		expect(loadSessionMutation.mutateAsync).not.toHaveBeenCalled();
	});

	it("loads session and sets active session on success", async () => {
		const store = createStore();
		const session = buildSession({
			cwd: "/home/user/project",
			machineId: "machine-1",
			backendId: "backend-1",
		});

		machinesState = {
			machines: { "machine-1": { capabilities: { list: true, load: true } } },
		};
		loadSessionMutation.mutateAsync.mockResolvedValue({
			sessionId: "session-1",
		});

		const { result } = renderHook(() => useSessionActivation(store));

		await act(async () => {
			await result.current.activateSession(session);
		});

		expect(store.setSessionLoading).toHaveBeenCalledWith("session-1", true);
		expect(store.clearSessionMessages).toHaveBeenCalledWith("session-1");
		expect(loadSessionMutation.mutateAsync).toHaveBeenCalledWith({
			sessionId: "session-1",
			cwd: "/home/user/project",
			backendId: "backend-1",
			machineId: "machine-1",
		});
		expect(store.setActiveSessionId).toHaveBeenCalledWith("session-1");
		expect(store.setSessionLoading).toHaveBeenCalledWith("session-1", false);
	});

	it("uses reload when forcing activation", async () => {
		const store = createStore();
		const session = buildSession({
			cwd: "/home/user/project",
			machineId: "machine-1",
			backendId: "backend-1",
			isAttached: true,
		});

		machinesState = {
			machines: { "machine-1": { capabilities: { list: true, load: true } } },
		};
		reloadSessionMutation.mutateAsync.mockResolvedValue({
			sessionId: "session-1",
		});

		const { result } = renderHook(() => useSessionActivation(store));

		await act(async () => {
			await result.current.activateSession(session, { force: true });
		});

		expect(reloadSessionMutation.mutateAsync).toHaveBeenCalledWith({
			sessionId: "session-1",
			cwd: "/home/user/project",
			backendId: "backend-1",
			machineId: "machine-1",
		});
		expect(loadSessionMutation.mutateAsync).not.toHaveBeenCalled();
	});

	it("restores messages when load fails", async () => {
		const store = createStore();
		const session = buildSession({
			cwd: "/home/user/project",
			machineId: "machine-1",
			backendId: "backend-1",
			messages: [
				{
					id: "msg-1",
					kind: "text",
					role: "user",
					content: "hi",
					contentBlocks: [],
					createdAt: "",
					isStreaming: false,
				},
			],
		});

		machinesState = {
			machines: { "machine-1": { capabilities: { list: true, load: true } } },
		};
		loadSessionMutation.mutateAsync.mockRejectedValue(new Error("fail"));

		const { result } = renderHook(() => useSessionActivation(store));

		await act(async () => {
			await result.current.activateSession(session);
		});

		expect(store.restoreSessionMessages).toHaveBeenCalledWith(
			"session-1",
			session.messages,
			{ lastAppliedSeq: session.lastAppliedSeq },
		);
		expect(store.setSessionLoading).toHaveBeenCalledWith("session-1", false);
	});
});
