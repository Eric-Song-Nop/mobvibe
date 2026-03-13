import { resolveWorktreeBranchName } from "@mobvibe/shared";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PermissionResultNotification } from "@/lib/acp";
import { fetchGitBranchesForCwd } from "@/lib/api";
import type { ChatSession, SessionListEntry } from "@/lib/chat-store";
import { useChatStore } from "@/lib/chat-store";
import {
	buildSessionE2EEKeyMissingError,
	buildSessionNotReadyError,
	createFallbackError,
	normalizeError,
} from "@/lib/error-utils";
import { getBackendCapability, type Machine } from "@/lib/machines-store";
import { useUiStore } from "@/lib/ui-store";
import { buildSessionTitle } from "@/lib/ui-utils";

type Mutations = {
	createSessionMutation: {
		mutateAsync: (params: {
			backendId: string;
			cwd: string;
			title?: string;
			machineId: string;
			worktree?: {
				branch?: string;
				baseBranch?: string;
				sourceCwd: string;
				relativeCwd?: string;
			};
		}) => Promise<unknown>;
		isPending: boolean;
	};
	renameSessionMutation: {
		mutate: (params: { sessionId: string; title: string }) => void;
	};
	archiveSessionMutation: {
		mutateAsync: (params: { sessionId: string }) => Promise<unknown>;
	};
	bulkArchiveSessionsMutation: {
		mutateAsync: (params: { sessionIds: string[] }) => Promise<unknown>;
		isPending: boolean;
	};
	cancelSessionMutation: {
		mutate: (params: { sessionId: string }) => void;
		mutateAsync: (params: { sessionId: string }) => Promise<unknown>;
	};
	setSessionModeMutation: {
		mutate: (params: { sessionId: string; modeId: string }) => void;
		isPending: boolean;
		variables?: { sessionId: string };
	};
	setSessionModelMutation: {
		mutate: (params: { sessionId: string; modelId: string }) => void;
		isPending: boolean;
		variables?: { sessionId: string };
	};
	sendMessageMutation: {
		mutate: (params: {
			sessionId: string;
			prompt: ChatSession["inputContents"];
			messageId?: string;
			draft?: {
				input: string;
				inputContents: ChatSession["inputContents"];
			};
		}) => void;
	};
	permissionDecisionMutation: {
		mutate: (params: {
			sessionId: string;
			requestId: string;
			outcome: PermissionResultNotification["outcome"];
		}) => void;
	};
};

type ChatActions = {
	setAppError: (error: ChatSession["error"]) => void;
	renameSession: (sessionId: string, title: string) => void;
	setError: (sessionId: string, error: ChatSession["error"]) => void;
	setSending: (sessionId: string, sending: boolean) => void;
	setCanceling: (sessionId: string, canceling: boolean) => void;
	addUserMessage: (
		sessionId: string,
		content: string,
		meta?: {
			messageId?: string;
			contentBlocks?: ChatSession["inputContents"];
			provisional?: boolean;
		},
	) => void;
};

type UiActions = {
	setMobileMenuOpen: (open: boolean) => void;
	setCreateDialogOpen: (open: boolean) => void;
	setDraftTitle: (title: string) => void;
	setDraftBackendId: (id: string | undefined) => void;
	setDraftCwd: (cwd: string | undefined) => void;
	resetDraftWorktree: () => void;
	clearEditingSession: () => void;
};

export type UseSessionHandlersParams = {
	sessions?: Record<string, ChatSession>;
	activeSessionId: string | undefined;
	activeSession: ChatSession | undefined;
	sessionList: SessionListEntry[];
	selectedMachineId: string | null;
	lastCreatedCwd: Record<string, string>;
	machines: Record<string, Machine>;
	defaultBackendId: string | undefined;
	/** CWD of the effective workspace (selected or auto-fallback first workspace) */
	effectiveWorkspaceCwd: string | undefined;
	chatActions: ChatActions;
	uiActions: UiActions;
	mutations: Mutations;
	activateSession: (
		session: ChatSession,
		options?: { force?: boolean },
	) => Promise<void>;
	isActivating: boolean;
	syncSessionHistory: (sessionId: string) => void;
};

export function useSessionHandlers({
	activeSessionId,
	activeSession,
	sessionList,
	selectedMachineId,
	lastCreatedCwd,
	machines,
	defaultBackendId,
	effectiveWorkspaceCwd,
	chatActions,
	uiActions,
	mutations,
	activateSession,
	isActivating,
	syncSessionHistory,
}: UseSessionHandlersParams) {
	const { t } = useTranslation();
	const [isForceReloading, setIsForceReloading] = useState(false);
	const activeSessionRef = useRef(activeSession);
	activeSessionRef.current = activeSession;

	const ensureSessionAttached = useCallback(async () => {
		const session = activeSessionRef.current;
		const sessionId = session?.sessionId;
		if (!session || !sessionId) {
			return undefined;
		}

		const latestSession =
			useChatStore.getState().sessions[sessionId] ?? session;
		if (latestSession.isAttached) {
			return latestSession;
		}
		if (latestSession.isLoading) {
			return undefined;
		}

		await activateSession(latestSession);

		const attachedSession = useChatStore.getState().sessions[sessionId];
		if (!attachedSession?.isAttached) {
			return undefined;
		}

		return attachedSession;
	}, [activateSession]);

	const handleOpenCreateDialog = (mode?: "workspace" | "session") => {
		uiActions.setDraftTitle(buildSessionTitle(sessionList, t));
		uiActions.setDraftBackendId(defaultBackendId);

		let initialCwd: string | undefined;

		// "session" mode: prefer the effective workspace CWD so the new session
		// is pre-filled with the currently visible workspace path.
		if (mode === "session" && effectiveWorkspaceCwd) {
			initialCwd = effectiveWorkspaceCwd;
		}

		// Fallback (workspace mode, no mode, or session mode without workspace):
		// lastCreatedCwd > activeSession cwd (same machine) > undefined (homePath in dialog)
		if (!initialCwd && selectedMachineId) {
			initialCwd = lastCreatedCwd[selectedMachineId];
			if (!initialCwd && activeSession?.machineId === selectedMachineId) {
				initialCwd = activeSession.worktreeSourceCwd || activeSession.cwd;
			}
		}

		uiActions.setDraftCwd(initialCwd);
		uiActions.resetDraftWorktree();
		uiActions.setMobileMenuOpen(false);
		uiActions.setCreateDialogOpen(true);
	};

	const handleCreateSession = async () => {
		const {
			draftTitle,
			draftBackendId,
			draftCwd,
			draftWorktreeEnabled,
			draftWorktreeBranch,
			draftWorktreeSuggestedBranch,
			draftWorktreeBaseBranch,
		} = useUiStore.getState();
		if (!selectedMachineId) {
			chatActions.setAppError(
				createFallbackError(t("errors.selectMachine"), "request"),
			);
			return;
		}
		if (!draftBackendId) {
			chatActions.setAppError(
				createFallbackError(t("errors.selectBackend"), "request"),
			);
			return;
		}
		if (!draftCwd) {
			chatActions.setAppError(
				createFallbackError(t("errors.selectDirectory"), "request"),
			);
			return;
		}
		const title = draftTitle.trim();
		const defaultTitle = buildSessionTitle(sessionList, t);
		const isUserCustomTitle = title.length > 0 && title !== defaultTitle;
		chatActions.setAppError(undefined);

		let worktree:
			| {
					branch?: string;
					baseBranch?: string;
					sourceCwd: string;
					relativeCwd?: string;
			  }
			| undefined;

		if (draftWorktreeEnabled) {
			const branch = resolveWorktreeBranchName(
				draftWorktreeBranch.trim() || draftWorktreeSuggestedBranch,
			);

			try {
				const projectContext = await fetchGitBranchesForCwd({
					machineId: selectedMachineId,
					cwd: draftCwd,
				});
				if (!projectContext.isGitRepo) {
					chatActions.setAppError(
						createFallbackError(t("errors.worktreeRequiresGitRepo"), "request"),
					);
					return;
				}
				worktree = {
					branch,
					baseBranch: draftWorktreeBaseBranch || undefined,
					sourceCwd: projectContext.repoRoot ?? draftCwd,
					relativeCwd: projectContext.relativeCwd,
				};
			} catch (error) {
				chatActions.setAppError(
					normalizeError(
						error,
						createFallbackError(t("session.worktree.queryError"), "request"),
					),
				);
				return;
			}
		}

		try {
			await mutations.createSessionMutation.mutateAsync({
				backendId: draftBackendId,
				cwd: draftCwd,
				title: isUserCustomTitle ? title : undefined,
				machineId: selectedMachineId,
				worktree,
			});
			uiActions.setCreateDialogOpen(false);
			uiActions.setMobileMenuOpen(false);
		} catch {
			return;
		}
	};

	const handleRenameSubmit = () => {
		const { editingSessionId, editingTitle } = useUiStore.getState();
		if (!editingSessionId) {
			return;
		}
		const title = editingTitle.trim();
		if (title.length === 0) {
			return;
		}
		chatActions.renameSession(editingSessionId, title);
		mutations.renameSessionMutation.mutate({
			sessionId: editingSessionId,
			title,
		});
		uiActions.clearEditingSession();
	};

	const handleArchiveSession = useCallback(
		async (sessionId: string) => {
			try {
				await mutations.archiveSessionMutation.mutateAsync({ sessionId });
			} catch {
				return;
			}
		},
		[mutations.archiveSessionMutation],
	);

	const handleBulkArchiveSessions = useCallback(
		async (sessionIds: string[]) => {
			try {
				await mutations.bulkArchiveSessionsMutation.mutateAsync({ sessionIds });
			} catch {
				return;
			}
		},
		[mutations.bulkArchiveSessionsMutation],
	);

	const handlePermissionDecision = useCallback(
		(payload: {
			requestId: string;
			outcome: PermissionResultNotification["outcome"];
		}) => {
			const session = activeSessionRef.current;
			const sessionId = session?.sessionId;
			if (!sessionId || !session) {
				return;
			}
			if (!session.isAttached) {
				chatActions.setError(sessionId, buildSessionNotReadyError());
				return;
			}
			mutations.permissionDecisionMutation.mutate({
				sessionId,
				requestId: payload.requestId,
				outcome: payload.outcome,
			});
		},
		[mutations.permissionDecisionMutation, chatActions.setError],
	);

	const handleModeChange = async (modeId: string) => {
		if (!activeSessionId || !activeSessionRef.current) {
			return;
		}
		const readySession = await ensureSessionAttached();
		if (!readySession) {
			return;
		}
		if (modeId === readySession.modeId) {
			return;
		}
		chatActions.setError(activeSessionId, undefined);
		mutations.setSessionModeMutation.mutate({
			sessionId: activeSessionId,
			modeId,
		});
	};

	const handleModelChange = async (modelId: string) => {
		if (!activeSessionId || !activeSessionRef.current) {
			return;
		}
		const readySession = await ensureSessionAttached();
		if (!readySession) {
			return;
		}
		if (modelId === readySession.modelId) {
			return;
		}
		chatActions.setError(activeSessionId, undefined);
		mutations.setSessionModelMutation.mutate({
			sessionId: activeSessionId,
			modelId,
		});
	};

	const handleCancel = () => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		if (!activeSession.sending || activeSession.canceling) {
			return;
		}
		if (!activeSession.isAttached) {
			chatActions.setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		mutations.cancelSessionMutation.mutate({ sessionId: activeSessionId });
	};

	const handleForceReload = async () => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		const loadCap = getBackendCapability(
			activeSession.machineId ? machines[activeSession.machineId] : undefined,
			activeSession.backendId,
			"load",
		);
		if (!activeSession.cwd || !activeSession.machineId || loadCap === false) {
			return;
		}
		if (activeSession.isLoading || isActivating || isForceReloading) {
			return;
		}

		setIsForceReloading(true);
		try {
			if (activeSession.sending && !activeSession.canceling) {
				if (activeSession.isAttached) {
					await mutations.cancelSessionMutation.mutateAsync({
						sessionId: activeSessionId,
					});
				}
			}
			const latestSession =
				useChatStore.getState().sessions[activeSessionId] ?? activeSession;
			await activateSession(latestSession, { force: true });
		} finally {
			setIsForceReloading(false);
		}
	};

	const handleSyncHistory = () => {
		if (!activeSessionId) {
			return;
		}
		syncSessionHistory(activeSessionId);
	};

	const handleSend = async () => {
		if (!activeSessionId || !activeSessionRef.current) {
			return;
		}
		const initialSession =
			useChatStore.getState().sessions[activeSessionId] ??
			activeSessionRef.current;
		const draft = useUiStore.getState().chatDrafts[activeSessionId];
		const promptContents = draft?.inputContents ?? initialSession.inputContents;
		const hasPromptContent = promptContents.some(
			(block) =>
				block.type === "resource_link" ||
				(block.type === "text" && block.text.trim().length > 0),
		);
		if (!hasPromptContent || initialSession.sending) {
			return;
		}

		const readySession = await ensureSessionAttached();
		if (!readySession) {
			return;
		}
		const latestDraft = useUiStore.getState().chatDrafts[activeSessionId];
		const latestPromptContents =
			latestDraft?.inputContents ?? readySession.inputContents;
		const latestPromptText = latestDraft?.input ?? readySession.input ?? "";
		const hasLatestPromptContent = latestPromptContents.some(
			(block) =>
				block.type === "resource_link" ||
				(block.type === "text" && block.text.trim().length > 0),
		);
		if (!hasLatestPromptContent || readySession.sending) {
			return;
		}
		if (readySession.e2eeStatus === undefined) {
			chatActions.setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		if (readySession.e2eeStatus === "missing_key") {
			chatActions.setError(activeSessionId, buildSessionE2EEKeyMissingError());
			return;
		}

		const messageId = crypto.randomUUID();

		chatActions.setSending(activeSessionId, true);
		chatActions.setCanceling(activeSessionId, false);
		chatActions.setError(activeSessionId, undefined);
		useUiStore.getState().clearChatDraft(activeSessionId);

		chatActions.addUserMessage(activeSessionId, latestPromptText, {
			messageId,
			contentBlocks: latestPromptContents,
			provisional: true,
		});
		mutations.sendMessageMutation.mutate({
			sessionId: activeSessionId,
			prompt: latestPromptContents,
			messageId,
			draft: {
				input: latestPromptText,
				inputContents: latestPromptContents,
			},
		});
	};

	return {
		isForceReloading,
		isBulkArchiving: mutations.bulkArchiveSessionsMutation.isPending,
		handleOpenCreateDialog,
		handleCreateSession,
		handleRenameSubmit,
		handleArchiveSession,
		handleBulkArchiveSessions,
		handlePermissionDecision,
		handleModeChange,
		handleModelChange,
		handleCancel,
		handleForceReload,
		handleSyncHistory,
		handleSend,
	};
}
