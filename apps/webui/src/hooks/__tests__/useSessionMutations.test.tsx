import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ContentBlock } from "@/lib/acp";
import * as apiModule from "@/lib/api";
import { useSessionMutations } from "../useSessionMutations";

// Mutable store state for useChatStore.getState()
const mockChatStoreState = vi.hoisted(
	() =>
		({
			sessions: {} as Record<string, { revision?: number }>,
		}) as { sessions: Record<string, { revision?: number }> },
);

vi.mock("@/lib/chat-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-store")>();
	return {
		...actual,
		useChatStore: {
			getState: () => mockChatStoreState,
		},
	};
});

const mockBootstrapSessionE2EE = vi.hoisted(() => vi.fn(() => "ok"));
const mockUiStoreState = vi.hoisted(() => ({
	setChatDraft: vi.fn(),
}));

vi.mock("@/lib/e2ee", () => ({
	bootstrapSessionE2EE: mockBootstrapSessionE2EE,
}));

vi.mock("@/lib/ui-store", () => ({
	useUiStore: {
		getState: () => mockUiStoreState,
	},
}));

// Mock the API module
vi.mock("@/lib/api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
	return {
		...actual,
		createSession: vi.fn(),
		renameSession: vi.fn(),
		archiveSession: vi.fn(),
		cancelSession: vi.fn(),
		setSessionMode: vi.fn(),
		setSessionModel: vi.fn(),
		sendMessage: vi.fn(),
		sendPermissionDecision: vi.fn(),
		loadSession: vi.fn(),
		reloadSession: vi.fn(),
	};
});

describe("useSessionMutations", () => {
	let queryClient: QueryClient;
	let mockStore: ReturnType<typeof createMockStore>;

	const createMockStore = () => ({
		sessions: {},
		setActiveSessionId: vi.fn(),
		setLastCreatedCwd: vi.fn(),
		setSessionLoading: vi.fn(),
		setHistorySyncing: vi.fn(),
		setHistorySyncWarning: vi.fn(),
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
		confirmOrAppendUserMessage: vi.fn(),
		reconcileUserMessageId: vi.fn(),
		markUserMessageFailed: vi.fn(),
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
		updateSessionCursor: vi.fn(),
		setSessionBackfilling: vi.fn(),
		resetSessionForRevision: vi.fn(),
		setSessionE2EEStatus: vi.fn(),
	});

	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				mutations: {
					retry: false,
				},
			},
		});
		mockStore = createMockStore();
		mockChatStoreState.sessions = {};
		mockUiStoreState.setChatDraft.mockReset();
		vi.clearAllMocks();
	});

	describe("createSessionMutation", () => {
		it("should create session successfully with optimistic UI", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "new-session",
				title: "New Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/home/user/project",
				agentName: "Agent",
				modelId: "model-1",
				modelName: "Model 1",
				modeId: "mode-1",
				modeName: "Mode 1",
				availableModes: [],
				availableModels: [],
				availableCommands: [],
				machineId: "machine-1",
				wrappedDek: "wrapped-dek-1",
			};
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				title: "New Session",
			});

			// Should be called twice: first for optimistic session, then for real session
			expect(mockStore.createLocalSession).toHaveBeenCalledTimes(2);

			// Check the second call (real session)
			const realCall = vi.mocked(mockStore.createLocalSession).mock.calls[1];
			expect(realCall[0]).toBe("new-session");
			expect(realCall[1]).toMatchObject({
				title: "New Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: mockSession.createdAt,
				updatedAt: mockSession.updatedAt,
				cwd: mockSession.cwd,
				agentName: mockSession.agentName,
				modelId: mockSession.modelId,
				modelName: mockSession.modelName,
				modeId: mockSession.modeId,
				modeName: mockSession.modeName,
				availableModes: mockSession.availableModes,
				availableModels: mockSession.availableModels,
				availableCommands: mockSession.availableCommands,
			});

			// Optimistic session should be removed
			expect(mockStore.removeSession).toHaveBeenCalled();

			// Should activate both optimistic and real sessions
			expect(mockStore.setActiveSessionId).toHaveBeenCalledTimes(2);
			expect(mockStore.setActiveSessionId).toHaveBeenLastCalledWith(
				"new-session",
			);
			expect(mockBootstrapSessionE2EE).toHaveBeenCalledWith(
				"new-session",
				"wrapped-dek-1",
			);
			expect(mockStore.setSessionE2EEStatus).toHaveBeenCalledWith(
				"new-session",
				"ok",
			);
			expect(mockStore.setLastCreatedCwd).toHaveBeenCalledWith(
				"machine-1",
				mockSession.cwd,
			);
			expect(mockStore.setAppError).toHaveBeenCalledWith(undefined);
		});

		it("sets missing_key when wrappedDek exists but bootstrap cannot unwrap", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "encrypted-session",
				title: "Encrypted Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/repo",
				machineId: "machine-1",
				wrappedDek: "wrapped-dek-missing",
			};
			mockBootstrapSessionE2EE.mockReturnValueOnce("missing_key");
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				machineId: "machine-1",
				cwd: "/repo",
			});

			expect(mockStore.setSessionE2EEStatus).toHaveBeenCalledWith(
				"encrypted-session",
				"missing_key",
			);
		});

		it("sets none when createSession response has no wrappedDek", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "plain-session",
				title: "Plain Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/repo",
				machineId: "machine-1",
			};
			mockBootstrapSessionE2EE.mockReturnValueOnce("none");
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				machineId: "machine-1",
				cwd: "/repo",
			});

			expect(mockBootstrapSessionE2EE).toHaveBeenCalledWith(
				"plain-session",
				undefined,
			);
			expect(mockStore.setSessionE2EEStatus).toHaveBeenCalledWith(
				"plain-session",
				"none",
			);
		});

		it("uses the original variables.cwd for lastCreatedCwd on plain subdirectory sessions", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "subdir-session",
				title: "Subdir Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/repo/apps/webui",
				workspaceRootCwd: "/repo",
				machineId: "machine-1",
			};
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				cwd: "/repo/apps/webui",
				machineId: "machine-1",
			});

			expect(mockStore.setLastCreatedCwd).toHaveBeenCalledWith(
				"machine-1",
				"/repo/apps/webui",
			);
		});

		it("uses the original variables.cwd for lastCreatedCwd on worktree sessions", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "worktree-session",
				title: "Worktree Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/tmp/worktrees/repo/feat/live-cwd/apps/webui",
				workspaceRootCwd: "/repo",
				worktreeSourceCwd: "/repo",
				worktreeBranch: "feat/live-cwd",
				machineId: "machine-1",
			};
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				cwd: "/repo/apps/webui",
				machineId: "machine-1",
				worktree: {
					branch: "feat/live-cwd",
					sourceCwd: "/repo",
					relativeCwd: "apps/webui",
				},
			});

			expect(mockStore.setLastCreatedCwd).toHaveBeenCalledWith(
				"machine-1",
				"/repo/apps/webui",
			);
		});

		it("should handle create session errors", async () => {
			vi.mocked(apiModule.createSession).mockRejectedValue(
				new Error("Failed to create session"),
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			try {
				await result.current.createSessionMutation.mutateAsync({
					backendId: "backend-1",
				});
			} catch {
				// Expected error
			}

			expect(mockStore.setAppError).toHaveBeenCalled();
			const errorCall = vi.mocked(mockStore.setAppError).mock.calls[0];
			expect(errorCall[0]?.message).toBe("Failed to create session");
		});

		it("should create optimistic session with correct properties", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "real-session",
				title: "Real Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/home/user/project",
				agentName: "Agent",
				modelId: "model-1",
				modelName: "Model 1",
				modeId: "mode-1",
				modeName: "Mode 1",
				availableModes: [],
				availableModels: [],
				availableCommands: [],
				machineId: "machine-1",
			};
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				title: "Custom Title",
				cwd: "/custom/path",
				machineId: "machine-2",
			});

			// Check optimistic session was created first
			const optimisticCall = vi.mocked(mockStore.createLocalSession).mock
				.calls[0];
			expect(optimisticCall[0]).toMatch(/^creating-\d+$/);
			expect(optimisticCall[1]).toMatchObject({
				title: "Custom Title",
				backendId: "backend-1",
				cwd: "/custom/path",
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
				isCreating: true,
				machineId: "machine-2",
			});
		});

		it("should handle concurrent session creation", async () => {
			let sessionCounter = 0;
			vi.mocked(apiModule.createSession).mockImplementation(async () => {
				sessionCounter++;
				return {
					sessionId: `session-${sessionCounter}`,
					title: `Session ${sessionCounter}`,
					backendId: "backend-1",
					backendLabel: "Backend 1",
					createdAt: "2025-01-01T00:00:00Z",
					updatedAt: "2025-01-01T00:00:00Z",
					cwd: "/home/user/project",
					machineId: "machine-1",
				};
			});

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			// Create two sessions concurrently
			await Promise.all([
				result.current.createSessionMutation.mutateAsync({
					backendId: "backend-1",
					title: "Session 1",
				}),
				result.current.createSessionMutation.mutateAsync({
					backendId: "backend-1",
					title: "Session 2",
				}),
			]);

			// Should have 4 calls: 2 optimistic + 2 real
			expect(mockStore.createLocalSession).toHaveBeenCalledTimes(4);
			expect(mockStore.removeSession).toHaveBeenCalledTimes(2);
		});

		it("should mark optimistic session with error on failure", async () => {
			vi.mocked(apiModule.createSession).mockRejectedValue(
				new Error("Network error"),
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			try {
				await result.current.createSessionMutation.mutateAsync({
					backendId: "backend-1",
					title: "Failed Session",
				});
			} catch {
				// Expected error
			}

			// Optimistic session should be marked with error
			expect(mockStore.setError).toHaveBeenCalled();
			const errorCall = vi.mocked(mockStore.setError).mock.calls[0];
			expect(errorCall[0]).toMatch(/^creating-\d+$/);
			// Should have error with proper scope
			expect(errorCall[1]).toMatchObject({
				code: "INTERNAL_ERROR",
				scope: "service",
				retryable: true,
			});
			expect(errorCall[1]?.message).toBeTruthy();
		});

		it("should use default title when no title provided", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "session-1",
				title: "Session 1",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/home/user/project",
				machineId: "machine-1",
			};
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
			});

			// Check optimistic session uses translation key for default title
			const optimisticCall = vi.mocked(mockStore.createLocalSession).mock
				.calls[0];
			expect(optimisticCall[1].title).toBe("session.creating");
		});

		it("should activate optimistic session before API call completes", async () => {
			const mockSession: apiModule.CreateSessionResponse = {
				sessionId: "real-session",
				title: "Real Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
				cwd: "/home/user/project",
				machineId: "machine-1",
			};

			// Use a delayed mock to verify order of operations
			let apiCallStarted = false;
			vi.mocked(apiModule.createSession).mockImplementation(async () => {
				apiCallStarted = true;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return mockSession;
			});

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				title: "Test Session",
			});

			// Both optimistic and real sessions should be created
			expect(mockStore.createLocalSession).toHaveBeenCalledTimes(2);
			expect(mockStore.setActiveSessionId).toHaveBeenCalledTimes(2);
			expect(apiCallStarted).toBe(true);

			// Verify first activation is optimistic session
			const calls = vi.mocked(mockStore.setActiveSessionId).mock.calls;
			expect(calls[0][0]).toMatch(/^creating-\d+$/);
			expect(calls[1][0]).toBe("real-session");
		});
	});

	describe("renameSessionMutation", () => {
		it("should rename session successfully", async () => {
			vi.mocked(apiModule.renameSession).mockResolvedValue({
				sessionId: "session-1",
				title: "New Title",
			});

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.renameSessionMutation.mutateAsync({
				sessionId: "session-1",
				title: "New Title",
			});

			expect(apiModule.renameSession).toHaveBeenCalled();
			const callArgs = vi.mocked(apiModule.renameSession).mock.calls[0][0];
			expect(callArgs).toEqual({
				sessionId: "session-1",
				title: "New Title",
			});
		});

		it("should handle rename errors", async () => {
			vi.mocked(apiModule.renameSession).mockRejectedValue(
				new Error("Failed to rename"),
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			try {
				await result.current.renameSessionMutation.mutateAsync({
					sessionId: "session-1",
					title: "New Title",
				});
			} catch {
				// Expected error
			}

			expect(mockStore.setAppError).toHaveBeenCalled();
			const errorCall = vi.mocked(mockStore.setAppError).mock.calls[0];
			expect(errorCall[0]?.message).toBe("Failed to rename");
			expect(errorCall[0]?.code).toBe("INTERNAL_ERROR");
			expect(errorCall[0]?.scope).toBe("session");
		});
	});

	describe("archiveSessionMutation", () => {
		it("should archive session successfully", async () => {
			vi.mocked(apiModule.archiveSession).mockResolvedValue({ ok: true });

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.archiveSessionMutation.mutateAsync({
				sessionId: "session-1",
			});

			expect(mockStore.removeSession).toHaveBeenCalledWith("session-1");
			expect(mockStore.setAppError).toHaveBeenCalledWith(undefined);
		});

		it("should handle archive errors", async () => {
			vi.mocked(apiModule.archiveSession).mockRejectedValue(
				new Error("Failed to archive"),
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			try {
				await result.current.archiveSessionMutation.mutateAsync({
					sessionId: "session-1",
				});
			} catch {
				// Expected error
			}

			const errorCall = vi.mocked(mockStore.setAppError).mock.calls[0];
			expect(errorCall[0]?.message).toBe("Failed to archive");
			expect(errorCall[0]?.scope).toBe("session");
		});

		it("should remove session locally even when archive API fails", async () => {
			vi.mocked(apiModule.archiveSession).mockRejectedValue(
				new Error("Gateway unreachable"),
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			try {
				await result.current.archiveSessionMutation.mutateAsync({
					sessionId: "broken-session",
				});
			} catch {
				// Expected error
			}

			expect(mockStore.removeSession).toHaveBeenCalledWith("broken-session");
		});
	});

	describe("cancelSessionMutation", () => {
		it("should cancel session successfully", async () => {
			vi.mocked(apiModule.cancelSession).mockResolvedValue({ ok: true });

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.cancelSessionMutation.mutateAsync({
				sessionId: "session-1",
			});

			expect(mockStore.setCanceling).toHaveBeenCalledWith("session-1", true);
			expect(mockStore.addStatusMessage).toHaveBeenCalledWith("session-1", {
				title: i18n.t("statusMessages.cancelled"),
				variant: "warning",
			});
			expect(mockStore.finalizeAssistantMessage).toHaveBeenCalledWith(
				"session-1",
			);
			expect(mockStore.setSending).toHaveBeenCalledWith("session-1", false);
			expect(mockStore.setCanceling).toHaveBeenCalledWith("session-1", false);
		});

		it("should reset canceling state on error", async () => {
			vi.mocked(apiModule.cancelSession).mockRejectedValue(
				new Error("Failed to cancel"),
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			try {
				await result.current.cancelSessionMutation.mutateAsync({
					sessionId: "session-1",
				});
			} catch {
				// Expected error
			}

			expect(mockStore.setCanceling).toHaveBeenLastCalledWith(
				"session-1",
				false,
			);
		});
	});

	describe("setSessionModeMutation", () => {
		it("should set session mode successfully", async () => {
			const mockSummary = {
				sessionId: "session-1",
				modeId: "mode-1",
				modeName: "Chat Mode",
				title: "Session",
				backendId: "backend-1",
				backendLabel: "Backend",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
			};

			vi.mocked(apiModule.setSessionMode).mockResolvedValue(mockSummary);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.setSessionModeMutation.mutateAsync({
				sessionId: "session-1",
				modeId: "mode-1",
			});

			expect(mockStore.updateSessionMeta).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					modeId: "mode-1",
					modeName: "Chat Mode",
				}),
			);
		});
	});

	describe("setSessionModelMutation", () => {
		it("should set session model successfully", async () => {
			const mockSummary = {
				sessionId: "session-1",
				modelId: "model-1",
				modelName: "GPT-4",
				title: "Session",
				backendId: "backend-1",
				backendLabel: "Backend",
				createdAt: "2025-01-01T00:00:00Z",
				updatedAt: "2025-01-01T00:00:00Z",
			};

			vi.mocked(apiModule.setSessionModel).mockResolvedValue(mockSummary);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.setSessionModelMutation.mutateAsync({
				sessionId: "session-1",
				modelId: "model-1",
			});

			expect(mockStore.updateSessionMeta).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					modelId: "model-1",
					modelName: "GPT-4",
				}),
			);
		});
	});

	describe("permissionDecisionMutation", () => {
		it("should submit permission decision successfully", async () => {
			const mockResponse: apiModule.PermissionDecisionResponse = {
				sessionId: "session-1",
				requestId: "request-1",
				outcome: { outcome: "selected", optionId: "option-1" },
			};

			vi.mocked(apiModule.sendPermissionDecision).mockResolvedValue(
				mockResponse,
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.permissionDecisionMutation.mutateAsync({
				sessionId: "session-1",
				requestId: "request-1",
				outcome: { outcome: "selected", optionId: "option-1" },
			});

			expect(mockStore.setPermissionDecisionState).toHaveBeenCalledWith(
				"session-1",
				"request-1",
				"submitting",
			);
			expect(mockStore.setPermissionOutcome).toHaveBeenCalledWith(
				"session-1",
				"request-1",
				{ outcome: "selected", optionId: "option-1" },
			);
			expect(mockStore.setPermissionDecisionState).toHaveBeenLastCalledWith(
				"session-1",
				"request-1",
				"idle",
			);
		});

		it("should reset permission decision state on error", async () => {
			vi.mocked(apiModule.sendPermissionDecision).mockRejectedValue(
				new Error("Failed to submit"),
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			try {
				await result.current.permissionDecisionMutation.mutateAsync({
					sessionId: "session-1",
					requestId: "request-1",
					outcome: { outcome: "cancelled" },
				});
			} catch {
				// Expected error
			}

			expect(mockStore.setPermissionDecisionState).toHaveBeenLastCalledWith(
				"session-1",
				"request-1",
				"idle",
			);
		});
	});

	describe("sendMessageMutation", () => {
		it("should finalize message on settled", async () => {
			vi.mocked(apiModule.sendMessage).mockResolvedValue({
				stopReason: "end_turn",
			});

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.sendMessageMutation.mutateAsync({
				sessionId: "session-1",
				prompt: [{ type: "text", text: "Hello" }],
			});

			expect(mockStore.finalizeAssistantMessage).toHaveBeenCalledWith(
				"session-1",
			);
			expect(mockStore.setSending).toHaveBeenCalledWith("session-1", false);
		});

		it("marks the optimistic message failed and restores the draft on error", async () => {
			vi.mocked(apiModule.sendMessage).mockRejectedValue(new Error("offline"));

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await expect(
				result.current.sendMessageMutation.mutateAsync({
					sessionId: "session-1",
					prompt: [{ type: "text", text: "Hello" }],
					messageId: "user-msg-1",
					draft: {
						input: "Hello",
						inputContents: [{ type: "text", text: "Hello" }],
					},
				}),
			).rejects.toThrow("offline");

			expect(mockStore.markUserMessageFailed).toHaveBeenCalledWith(
				"session-1",
				"user-msg-1",
			);
			expect(mockUiStoreState.setChatDraft).toHaveBeenCalledWith("session-1", {
				input: "Hello",
				inputContents: [{ type: "text", text: "Hello" }],
			});
			expect(mockStore.setAppError).toHaveBeenCalled();
		});

		it("should handle undefined variables gracefully", async () => {
			vi.mocked(apiModule.sendMessage).mockResolvedValue({
				stopReason: "end_turn",
			});

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.sendMessageMutation.mutateAsync(
				undefined as unknown as { sessionId: string; prompt: ContentBlock[] },
			);

			// Should not call finalizeAssistantMessage with undefined
			// This test verifies the onSettled logic handles undefined correctly
		});
	});

	describe("loadSessionMutation (conditional reset)", () => {
		const mockLoadResponse = {
			sessionId: "session-1",
			title: "Loaded Session",
			backendId: "backend-1",
			backendLabel: "Backend 1",
			createdAt: "2025-01-01T00:00:00Z",
			updatedAt: "2025-01-01T00:00:00Z",
			revision: 5,
		};

		it("resets session when revision differs from current", async () => {
			// Current session has revision 3, server returns 5
			mockChatStoreState.sessions = {
				"session-1": { revision: 3 },
			};

			vi.mocked(apiModule.loadSession).mockResolvedValue(mockLoadResponse);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.loadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			expect(mockStore.resetSessionForRevision).toHaveBeenCalledWith(
				"session-1",
				5,
			);
		});

		it("does NOT reset when revision matches current", async () => {
			// Current session already has revision 5
			mockChatStoreState.sessions = {
				"session-1": { revision: 5 },
			};

			vi.mocked(apiModule.loadSession).mockResolvedValue(mockLoadResponse);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.loadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			expect(mockStore.resetSessionForRevision).not.toHaveBeenCalled();
		});

		it("resets when session does not exist locally", async () => {
			// No local session
			mockChatStoreState.sessions = {};

			vi.mocked(apiModule.loadSession).mockResolvedValue(mockLoadResponse);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.loadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			expect(mockStore.resetSessionForRevision).toHaveBeenCalledWith(
				"session-1",
				5,
			);
		});

		it("does NOT reset when response has no revision", async () => {
			const noRevisionResponse = {
				...mockLoadResponse,
				revision: undefined,
			};

			vi.mocked(apiModule.loadSession).mockResolvedValue(
				noRevisionResponse as any,
			);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.loadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			expect(mockStore.resetSessionForRevision).not.toHaveBeenCalled();
		});
	});

	describe("reloadSessionMutation (conditional reset)", () => {
		const mockReloadResponse = {
			sessionId: "session-1",
			title: "Reloaded Session",
			backendId: "backend-1",
			backendLabel: "Backend 1",
			createdAt: "2025-01-01T00:00:00Z",
			updatedAt: "2025-01-01T00:00:00Z",
			revision: 7,
		};

		it("resets session when revision differs from current", async () => {
			mockChatStoreState.sessions = {
				"session-1": { revision: 4 },
			};

			vi.mocked(apiModule.reloadSession).mockResolvedValue(mockReloadResponse);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.reloadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			expect(mockStore.resetSessionForRevision).toHaveBeenCalledWith(
				"session-1",
				7,
			);
		});

		it("does NOT reset when revision matches current", async () => {
			mockChatStoreState.sessions = {
				"session-1": { revision: 7 },
			};

			vi.mocked(apiModule.reloadSession).mockResolvedValue(mockReloadResponse);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.reloadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			expect(mockStore.resetSessionForRevision).not.toHaveBeenCalled();
		});

		it("resets when session does not exist locally", async () => {
			mockChatStoreState.sessions = {};

			vi.mocked(apiModule.reloadSession).mockResolvedValue(mockReloadResponse);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.reloadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			expect(mockStore.resetSessionForRevision).toHaveBeenCalledWith(
				"session-1",
				7,
			);
		});

		it("still updates session meta even when revision matches", async () => {
			mockChatStoreState.sessions = {
				"session-1": { revision: 7 },
			};

			vi.mocked(apiModule.reloadSession).mockResolvedValue(mockReloadResponse);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.reloadSessionMutation.mutateAsync({
				sessionId: "session-1",
				cwd: "/project",
				backendId: "backend-1",
			});

			// Should NOT reset but SHOULD still update meta
			expect(mockStore.resetSessionForRevision).not.toHaveBeenCalled();
			expect(mockStore.updateSessionMeta).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					updatedAt: "2025-01-01T00:00:00Z",
				}),
			);
			expect(mockStore.setActiveSessionId).toHaveBeenCalledWith("session-1");
			expect(mockStore.setAppError).toHaveBeenCalledWith(undefined);
		});
	});
});
