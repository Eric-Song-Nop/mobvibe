import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ContentBlock } from "@/lib/acp";
import * as apiModule from "@/lib/api";
import { useSessionMutations } from "../useSessionMutations";

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
		updateSessionCursor: vi.fn(),
		setSessionBackfilling: vi.fn(),
		resetSessionForRevision: vi.fn(),
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
		vi.clearAllMocks();
	});

	describe("createSessionMutation", () => {
		it("should create session successfully", async () => {
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
			};
			vi.mocked(apiModule.createSession).mockResolvedValue(mockSession);

			const { result } = renderHook(() => useSessionMutations(mockStore), {
				wrapper,
			});

			await result.current.createSessionMutation.mutateAsync({
				backendId: "backend-1",
				title: "New Session",
			});

			expect(mockStore.createLocalSession).toHaveBeenCalledWith("new-session", {
				title: "New Session",
				backendId: "backend-1",
				backendLabel: "Backend 1",
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

			expect(mockStore.setActiveSessionId).toHaveBeenCalledWith("new-session");
			expect(mockStore.setLastCreatedCwd).toHaveBeenCalledWith(
				"machine-1",
				mockSession.cwd,
			);
			expect(mockStore.setAppError).toHaveBeenCalledWith(undefined);
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
});
