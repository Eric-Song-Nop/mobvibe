import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PermissionResultNotification } from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";
import { useChatStore } from "@/lib/chat-store";
import {
	buildSessionNotReadyError,
	createFallbackError,
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
		}) => void;
	};
	createMessageIdMutation: {
		mutateAsync: (params: {
			sessionId: string;
		}) => Promise<{ messageId: string }>;
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
	setInput: (sessionId: string, input: string) => void;
	setInputContents: (
		sessionId: string,
		contents: ChatSession["inputContents"],
	) => void;
	addUserMessage: (
		sessionId: string,
		content: string,
		meta?: { messageId?: string; contentBlocks?: ChatSession["inputContents"] },
	) => void;
};

type UiActions = {
	setMobileMenuOpen: (open: boolean) => void;
	setCreateDialogOpen: (open: boolean) => void;
	setDraftTitle: (title: string) => void;
	setDraftBackendId: (id: string | undefined) => void;
	setDraftCwd: (cwd: string | undefined) => void;
	clearEditingSession: () => void;
};

export type UseSessionHandlersParams = {
	sessions: Record<string, ChatSession>;
	activeSessionId: string | undefined;
	activeSession: ChatSession | undefined;
	sessionList: ChatSession[];
	selectedMachineId: string | null;
	lastCreatedCwd: Record<string, string>;
	machines: Record<string, Machine>;
	defaultBackendId: string | undefined;
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

	const handleOpenCreateDialog = () => {
		uiActions.setDraftTitle(buildSessionTitle(sessionList, t));
		uiActions.setDraftBackendId(defaultBackendId);
		uiActions.setDraftCwd(
			selectedMachineId ? lastCreatedCwd[selectedMachineId] : undefined,
		);
		uiActions.setCreateDialogOpen(true);
	};

	const handleCreateSession = async () => {
		const { draftTitle, draftBackendId, draftCwd } = useUiStore.getState();
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
		chatActions.setAppError(undefined);
		try {
			await mutations.createSessionMutation.mutateAsync({
				backendId: draftBackendId,
				cwd: draftCwd,
				title: title.length > 0 ? title : undefined,
				machineId: selectedMachineId,
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

	const handleModeChange = (modeId: string) => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		if (!activeSession.isAttached) {
			chatActions.setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		if (modeId === activeSession.modeId) {
			return;
		}
		chatActions.setError(activeSessionId, undefined);
		mutations.setSessionModeMutation.mutate({
			sessionId: activeSessionId,
			modeId,
		});
	};

	const handleModelChange = (modelId: string) => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		if (!activeSession.isAttached) {
			chatActions.setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		if (modelId === activeSession.modelId) {
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
		if (!activeSessionId || !activeSession) {
			return;
		}
		const promptContents = activeSession.inputContents;
		if (!promptContents.length || activeSession.sending) {
			return;
		}
		if (!activeSession.isAttached) {
			chatActions.setError(activeSessionId, buildSessionNotReadyError());
			return;
		}

		chatActions.setSending(activeSessionId, true);
		chatActions.setCanceling(activeSessionId, false);
		chatActions.setError(activeSessionId, undefined);
		chatActions.setInput(activeSessionId, "");
		chatActions.setInputContents(activeSessionId, [{ type: "text", text: "" }]);

		let messageId: string;
		try {
			const response = await mutations.createMessageIdMutation.mutateAsync({
				sessionId: activeSessionId,
			});
			messageId = response.messageId;
		} catch {
			return;
		}

		chatActions.addUserMessage(activeSessionId, activeSession.input ?? "", {
			messageId,
			contentBlocks: promptContents,
		});
		mutations.sendMessageMutation.mutate({
			sessionId: activeSessionId,
			prompt: promptContents,
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
