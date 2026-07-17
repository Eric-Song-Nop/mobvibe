import { useQueryClient } from "@tanstack/react-query";
import {
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMachineDiscovery } from "@/hooks/useMachineDiscovery";
import { useMachinesQuery } from "@/hooks/useMachinesQuery";
import { useSessionActivation } from "@/hooks/useSessionActivation";
import { useSessionHandlers } from "@/hooks/useSessionHandlers";
import { useSessionList } from "@/hooks/useSessionList";
import { useSessionMutations } from "@/hooks/useSessionMutations";
import { useSessionQueries } from "@/hooks/useSessionQueries";
import { useSocket } from "@/hooks/useSocket";
import { useChatStore } from "@/lib/chat-store";
import { bootstrapSessionE2EE } from "@/lib/e2ee";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { isInputFocused, registerHotkeys } from "@/lib/hotkeys";
import { getBackendCapability, useMachinesStore } from "@/lib/machines-store";
import { ensureNotificationPermission } from "@/lib/notifications";
import { shouldActivateSessionOnSelect } from "@/lib/session-selection";
import { getContextLeftPercent } from "@/lib/session-usage";
import { useUiStore } from "@/lib/ui-store";
import { getPathBasename } from "@/lib/ui-utils";

export function useMainAppController() {
	const { t } = useTranslation();
	const { isAuthenticated } = useAuth();
	const [searchParams, setSearchParams] = useSearchParams();
	const notificationSessionId = searchParams.get("sessionId");
	const handlingNotificationSessionIdRef = useRef<string | null>(null);

	// Reactive state — re-renders only when these values change
	const { activeSessionId, appError, lastCreatedCwd } = useChatStore(
		useShallow((s) => ({
			activeSessionId: s.activeSessionId,
			appError: s.appError,
			lastCreatedCwd: s.lastCreatedCwd,
		})),
	);

	// Actions — stable refs, never trigger re-renders
	const chatActions = useChatStore(
		useShallow((s) => ({
			setActiveSessionId: s.setActiveSessionId,
			setAppError: s.setAppError,
			setLastCreatedCwd: s.setLastCreatedCwd,
			setSessionLoading: s.setSessionLoading,
			setHistorySyncing: s.setHistorySyncing,
			setHistorySyncWarning: s.setHistorySyncWarning,
			markSessionAttached: s.markSessionAttached,
			markSessionDetached: s.markSessionDetached,
			createLocalSession: s.createLocalSession,
			syncSessions: s.syncSessions,
			removeSession: s.removeSession,
			renameSession: s.renameSession,
			setError: s.setError,
			setSending: s.setSending,
			setCanceling: s.setCanceling,
			setSessionE2EEStatus: s.setSessionE2EEStatus,
			setStreamError: s.setStreamError,
			updateSessionMeta: s.updateSessionMeta,
			addUserMessage: s.addUserMessage,
			addStatusMessage: s.addStatusMessage,
			appendAssistantChunk: s.appendAssistantChunk,
			appendThoughtChunk: s.appendThoughtChunk,
			confirmOrAppendUserMessage: s.confirmOrAppendUserMessage,
			markUserMessageFailed: s.markUserMessageFailed,
			finalizeAssistantMessage: s.finalizeAssistantMessage,
			addPermissionRequest: s.addPermissionRequest,
			setPermissionDecisionState: s.setPermissionDecisionState,
			setPermissionOutcome: s.setPermissionOutcome,
			addToolCall: s.addToolCall,
			updateToolCall: s.updateToolCall,
			appendTerminalOutput: s.appendTerminalOutput,
			handleSessionsChanged: s.handleSessionsChanged,
			clearSessionMessages: s.clearSessionMessages,
			restoreSessionMessages: s.restoreSessionMessages,
			updateSessionCursor: s.updateSessionCursor,
			resetSessionForRevision: s.resetSessionForRevision,
		})),
	);

	// UI store — reactive state
	const {
		createDialogOpen,
		fileExplorerOpen,
		filePreviewPath,
		commandPaletteOpen,
		chatSearchOpen,
		draftBackendId,
		selectedWorkspaceByMachine,
	} = useUiStore(
		useShallow((s) => ({
			createDialogOpen: s.createDialogOpen,
			fileExplorerOpen: s.fileExplorerOpen,
			filePreviewPath: s.filePreviewPath,
			commandPaletteOpen: s.commandPaletteOpen,
			chatSearchOpen: s.chatSearchOpen,
			draftBackendId: s.draftBackendId,
			selectedWorkspaceByMachine: s.selectedWorkspaceByMachine,
		})),
	);

	// UI store — actions (stable refs)
	const uiActions = useUiStore(
		useShallow((s) => ({
			setMobileMenuOpen: s.setMobileMenuOpen,
			setCreateDialogOpen: s.setCreateDialogOpen,
			setFileExplorerOpen: s.setFileExplorerOpen,
			setFilePreviewPath: s.setFilePreviewPath,
			setCommandPaletteOpen: s.setCommandPaletteOpen,
			setChatSearchOpen: s.setChatSearchOpen,
			clearEditingSession: s.clearEditingSession,
			setDraftTitle: s.setDraftTitle,
			setDraftBackendId: s.setDraftBackendId,
			setDraftCwd: s.setDraftCwd,
			setDraftAdditionalDirectories: s.setDraftAdditionalDirectories,
			resetDraftWorktree: s.resetDraftWorktree,
			setSelectedWorkspace: s.setSelectedWorkspace,
		})),
	);

	const queryClient = useQueryClient();
	const {
		sessionsQuery,
		backendsQuery,
		availableBackends,
		discoverSessionsMutation,
	} = useSessionQueries();
	const defaultBackendId = availableBackends[0]?.backendId;
	useMachinesQuery();

	const { activateSession, activationState } =
		useSessionActivation(chatActions);

	const isActivating = activationState.phase !== "idle";

	const {
		syncSessionSummaries,
		syncSessionHistory,
		clearTrackedSession,
		isBackfilling,
	} = useSocket({
		syncSessions: chatActions.syncSessions,
		setSending: chatActions.setSending,
		setCanceling: chatActions.setCanceling,
		finalizeAssistantMessage: chatActions.finalizeAssistantMessage,
		appendAssistantChunk: chatActions.appendAssistantChunk,
		appendThoughtChunk: chatActions.appendThoughtChunk,
		confirmOrAppendUserMessage: chatActions.confirmOrAppendUserMessage,
		updateSessionMeta: chatActions.updateSessionMeta,
		setStreamError: chatActions.setStreamError,
		addPermissionRequest: chatActions.addPermissionRequest,
		setPermissionDecisionState: chatActions.setPermissionDecisionState,
		setPermissionOutcome: chatActions.setPermissionOutcome,
		addToolCall: chatActions.addToolCall,
		updateToolCall: chatActions.updateToolCall,
		appendTerminalOutput: chatActions.appendTerminalOutput,
		handleSessionsChanged: chatActions.handleSessionsChanged,
		markSessionAttached: chatActions.markSessionAttached,
		markSessionDetached: chatActions.markSessionDetached,
		createLocalSession: chatActions.createLocalSession,
		updateSessionCursor: chatActions.updateSessionCursor,
		resetSessionForRevision: chatActions.resetSessionForRevision,
		onReconnect: () => {
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			queryClient.invalidateQueries({ queryKey: ["acp-backends"] });
		},
	});

	const mutations = useSessionMutations(chatActions, {
		onSessionDeleted: clearTrackedSession,
	});

	const { machines, selectedMachineId, setSelectedMachineId } =
		useMachinesStore(
			useShallow((s) => ({
				machines: s.machines,
				selectedMachineId: s.selectedMachineId,
				setSelectedMachineId: s.setSelectedMachineId,
			})),
		);
	const updateBackendCapabilities = useMachinesStore(
		(s) => s.updateBackendCapabilities,
	);

	// --- Extracted hooks ---

	const {
		workspaceList,
		activeSession,
		selectedWorkspaceCwd,
		effectiveWorkspaceCwd,
		sessionList,
	} = useSessionList({
		activeSessionId,
		selectedMachineId,
		selectedWorkspaceByMachine,
	});

	useMachineDiscovery({
		machines,
		selectedWorkspaceByMachine,
		discoverMachines: discoverSessionsMutation.mutate,
		updateBackendCapabilities,
	});

	const {
		isForceReloading,
		isBulkArchiving,
		deletingSessionId,
		handleOpenCreateDialog,
		handleCreateSession,
		handleRenameSubmit,
		handleArchiveSession,
		handleCloseSession,
		handleDeleteSession,
		handleBulkArchiveSessions,
		handlePermissionDecision,
		handleModeChange,
		handleModelChange,
		handleSessionConfigChange,
		handleCancel,
		handleForceReload,
		handleSyncHistory,
		handleSend,
	} = useSessionHandlers({
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
	});

	// --- Effects ---

	useEffect(() => {
		if (sessionsQuery.data?.sessions) {
			syncSessionSummaries(sessionsQuery.data.sessions);

			// Bootstrap session DEKs and keep runtime E2EE status in sync.
			const { setSessionE2EEStatus } = useChatStore.getState();
			for (const session of sessionsQuery.data.sessions) {
				setSessionE2EEStatus(
					session.sessionId,
					bootstrapSessionE2EE(
						session.sessionId,
						session.wrappedDek,
						session.revision,
					),
				);
			}
		}
	}, [sessionsQuery.data?.sessions, syncSessionSummaries]);

	useEffect(() => {
		void ensureNotificationPermission({ isAuthenticated });
	}, [isAuthenticated]);

	// 启动时从持久化的 activeSession 恢复 selectedMachineId
	useEffect(() => {
		if (selectedMachineId) return;
		if (!activeSession?.machineId) return;
		const machine = machines[activeSession.machineId];
		if (machine) {
			setSelectedMachineId(activeSession.machineId);
		}
	}, [
		selectedMachineId,
		activeSession?.machineId,
		machines,
		setSelectedMachineId,
	]);

	// 清除无效的 activeSessionId（不自动选中）
	useEffect(() => {
		if (!activeSessionId) return;
		if (activeSession && !selectedMachineId) {
			// Delay invalidation until machine context is restored; otherwise a
			// persisted active session can be cleared before machine selection syncs.
			return;
		}
		const isActiveInList = sessionList.some(
			(session) => session.sessionId === activeSessionId,
		);
		if (!isActiveInList) {
			chatActions.setActiveSessionId(undefined);
		}
	}, [
		activeSession,
		activeSessionId,
		selectedMachineId,
		sessionList,
		chatActions.setActiveSessionId,
	]);

	useEffect(() => {
		if (!activeSession?.machineId || !activeSession.cwd) {
			return;
		}
		const workspaceCwd =
			activeSession.workspaceRootCwd ||
			activeSession.worktreeSourceCwd ||
			activeSession.cwd;
		uiActions.setSelectedWorkspace(activeSession.machineId, workspaceCwd);
	}, [
		activeSession?.cwd,
		activeSession?.machineId,
		activeSession?.workspaceRootCwd,
		activeSession?.worktreeSourceCwd,
		uiActions.setSelectedWorkspace,
	]);

	useEffect(() => {
		if (!selectedMachineId) {
			return;
		}
		if (selectedWorkspaceCwd || workspaceList.length === 0) {
			return;
		}
		uiActions.setSelectedWorkspace(selectedMachineId, workspaceList[0].cwd);
	}, [
		selectedMachineId,
		selectedWorkspaceCwd,
		uiActions.setSelectedWorkspace,
		workspaceList,
	]);

	useEffect(() => {
		if (!notificationSessionId) {
			handlingNotificationSessionIdRef.current = null;
			return;
		}
		if (handlingNotificationSessionIdRef.current === notificationSessionId) {
			return;
		}

		const targetSession =
			useChatStore.getState().sessions[notificationSessionId];
		if (!targetSession) {
			return;
		}

		handlingNotificationSessionIdRef.current = notificationSessionId;
		startTransition(() => {
			void activateSession(targetSession).finally(() => {
				const nextParams = new URLSearchParams(searchParams);
				nextParams.delete("sessionId");
				setSearchParams(nextParams, { replace: true });
				handlingNotificationSessionIdRef.current = null;
			});
		});
	}, [activateSession, notificationSessionId, searchParams, setSearchParams]);

	useEffect(() => {
		if (!createDialogOpen) {
			return;
		}
		if (!draftBackendId && defaultBackendId) {
			uiActions.setDraftBackendId(defaultBackendId);
		}
	}, [
		createDialogOpen,
		defaultBackendId,
		draftBackendId,
		uiActions.setDraftBackendId,
	]);

	// --- Global hotkeys ---
	const chatMessageListRef = useRef<{ scrollToIndex: (index: number) => void }>(
		null,
	);

	useEffect(() => {
		return registerHotkeys([
			{
				key: "k",
				mod: true,
				handler: () => uiActions.setCommandPaletteOpen(true),
			},
			{
				key: "f",
				mod: true,
				handler: () => {
					if (!isInputFocused()) {
						uiActions.setChatSearchOpen(true);
					}
				},
			},
			{
				key: "b",
				mod: true,
				handler: () =>
					uiActions.setMobileMenuOpen(!useUiStore.getState().mobileMenuOpen),
			},
			{
				key: "n",
				mod: true,
				handler: () => handleOpenCreateDialog(),
			},
		]);
	}, [uiActions, handleOpenCreateDialog]);

	const handleScrollToMessage = useCallback((index: number) => {
		chatMessageListRef.current?.scrollToIndex(index);
	}, []);

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			const session = useChatStore.getState().sessions[sessionId];
			if (!session) {
				chatActions.setActiveSessionId(sessionId);
				return;
			}

			if (shouldActivateSessionOnSelect(session)) {
				void activateSession(session);
				return;
			}

			chatActions.setActiveSessionId(sessionId);
		},
		[activateSession, chatActions.setActiveSessionId],
	);

	// --- Derived display state ---

	const fileExplorerAvailable = Boolean(
		activeSessionId &&
			activeSession?.cwd &&
			activeSession?.isAttached &&
			!activeSession?.isLoading,
	);
	const syncHistoryAvailable = Boolean(activeSessionId);
	const syncHistoryDisabled =
		!syncHistoryAvailable ||
		Boolean(
			activeSession?.isLoading ||
				activeSession?.historySyncing ||
				isActivating ||
				isForceReloading ||
				(activeSessionId && isBackfilling(activeSessionId)),
		);
	const forceReloadAvailable = Boolean(
		activeSessionId &&
			activeSession?.machineId &&
			activeSession?.cwd &&
			getBackendCapability(
				machines[activeSession.machineId],
				activeSession.backendId,
				"load",
			) !== false,
	);
	const forceReloadDisabled =
		!forceReloadAvailable ||
		Boolean(
			activeSession?.isLoading ||
				activeSession?.historySyncing ||
				isActivating ||
				isForceReloading ||
				(activeSessionId && isBackfilling(activeSessionId)),
		);

	useEffect(() => {
		if (fileExplorerAvailable) {
			return;
		}
		uiActions.setFileExplorerOpen(false);
		uiActions.setFilePreviewPath(undefined);
	}, [
		fileExplorerAvailable,
		uiActions.setFileExplorerOpen,
		uiActions.setFilePreviewPath,
	]);

	const statusMessage = useMemo(() => {
		if (backendsQuery.isError) {
			return normalizeError(
				backendsQuery.error,
				createFallbackError(t("errors.backendsFetchFailed"), "service"),
			).message;
		}
		if (sessionsQuery.isError) {
			return normalizeError(
				sessionsQuery.error,
				createFallbackError(t("errors.sessionsFetchFailed"), "service"),
			).message;
		}
		return appError?.message ?? activeSession?.error?.message;
	}, [
		activeSession?.error?.message,
		appError?.message,
		backendsQuery.error,
		backendsQuery.isError,
		sessionsQuery.error,
		sessionsQuery.isError,
		t,
	]);

	const warningMessage = activeSession?.historySyncWarning?.message;

	const loadingMessage = useMemo(() => {
		if (
			mutations.loadSessionMutation.isPending &&
			mutations.loadSessionMutation.variables?.sessionId === activeSessionId
		) {
			return t("session.loadingHistory");
		}
		if (
			mutations.reloadSessionMutation.isPending &&
			mutations.reloadSessionMutation.variables?.sessionId === activeSessionId
		) {
			return t("session.reloadingHistory");
		}
		if (
			discoverSessionsMutation.isPending &&
			discoverSessionsMutation.variables?.machineId === selectedMachineId
		) {
			return t("cli.discoveringCapabilities");
		}
		if (
			mutations.setSessionModeMutation.isPending &&
			mutations.setSessionModeMutation.variables?.sessionId === activeSessionId
		) {
			return t("session.switchingMode");
		}
		if (
			mutations.setSessionModelMutation.isPending &&
			mutations.setSessionModelMutation.variables?.sessionId === activeSessionId
		) {
			return t("session.switchingModel");
		}
		if (
			mutations.setSessionConfigOptionMutation.isPending &&
			mutations.setSessionConfigOptionMutation.variables?.sessionId ===
				activeSessionId
		) {
			return t("chat.updatingSessionConfig");
		}
		if (activeSession?.historySyncing) {
			return t("session.syncingHistory");
		}
		return undefined;
	}, [
		activeSession?.historySyncing,
		activeSessionId,
		discoverSessionsMutation.isPending,
		discoverSessionsMutation.variables,
		mutations.loadSessionMutation.isPending,
		mutations.loadSessionMutation.variables,
		mutations.reloadSessionMutation.isPending,
		mutations.reloadSessionMutation.variables,
		mutations.setSessionModeMutation.isPending,
		mutations.setSessionModeMutation.variables,
		mutations.setSessionModelMutation.isPending,
		mutations.setSessionModelMutation.variables,
		mutations.setSessionConfigOptionMutation.isPending,
		mutations.setSessionConfigOptionMutation.variables?.sessionId,
		selectedMachineId,
		t,
	]);

	const mutationsSnapshot = useMemo(
		(): import("@/lib/session-utils").SessionMutationsSnapshot => ({
			loadSessionPending: mutations.loadSessionMutation.isPending,
			loadSessionVariables: mutations.loadSessionMutation.variables,
			reloadSessionPending: mutations.reloadSessionMutation.isPending,
			reloadSessionVariables: mutations.reloadSessionMutation.variables,
		}),
		[
			mutations.loadSessionMutation.isPending,
			mutations.loadSessionMutation.variables,
			mutations.reloadSessionMutation.isPending,
			mutations.reloadSessionMutation.variables,
		],
	);

	const streamError = activeSession?.streamError;
	const backendLabel = activeSession?.backendLabel ?? activeSession?.backendId;
	const workspaceRootCwd =
		activeSession?.workspaceRootCwd ??
		activeSession?.worktreeSourceCwd ??
		activeSession?.cwd;
	const workspaceLabel = getPathBasename(workspaceRootCwd) ?? workspaceRootCwd;
	const subdirectoryLabel =
		workspaceRootCwd && activeSession?.cwd
			? activeSession.cwd.startsWith(`${workspaceRootCwd}/`) ||
				activeSession.cwd.startsWith(`${workspaceRootCwd}\\`)
				? activeSession.cwd.slice(workspaceRootCwd.length + 1)
				: undefined
			: undefined;
	const executionMode: "local" | "worktree" = activeSession?.worktreeBranch
		? "worktree"
		: "local";
	const contextLeftPercent = getContextLeftPercent(activeSession?.usage);
	const isModeSwitching =
		mutations.setSessionModeMutation.isPending &&
		mutations.setSessionModeMutation.variables?.sessionId === activeSessionId;
	const isModelSwitching =
		mutations.setSessionModelMutation.isPending &&
		mutations.setSessionModelMutation.variables?.sessionId === activeSessionId;
	const pendingConfigId =
		mutations.setSessionConfigOptionMutation.isPending &&
		mutations.setSessionConfigOptionMutation.variables?.sessionId ===
			activeSessionId
			? mutations.setSessionConfigOptionMutation.variables.configId
			: undefined;

	return {
		activeSession,
		activeSessionId,
		availableBackends,
		backendLabel,
		chatMessageListRef,
		chatSearchOpen,
		commandPaletteOpen,
		contextLeftPercent,
		createDialogOpen,
		executionMode,
		fileExplorerAvailable,
		fileExplorerOpen,
		filePreviewPath,
		forceReloadDisabled,
		handleArchiveSession,
		handleCloseSession,
		handleDeleteSession,
		handleBulkArchiveSessions,
		handleCancel,
		handleCreateSession,
		handleForceReload,
		handleModeChange,
		handleModelChange,
		handleSessionConfigChange,
		handleOpenCreateDialog,
		handlePermissionDecision,
		handleRenameSubmit,
		handleScrollToMessage,
		handleSelectSession,
		handleSend,
		handleSyncHistory,
		isBulkArchiving,
		deletingSessionId,
		isCreatingSession: mutations.createSessionMutation.isPending,
		isModeSwitching,
		isModelSwitching,
		pendingConfigId,
		loadingMessage,
		mutationsSnapshot,
		plan: activeSession?.plan,
		selectedMachineId,
		sessionList,
		statusMessage,
		streamError,
		subdirectoryLabel,
		syncHistoryAvailable,
		syncHistoryDisabled,
		uiActions,
		warningMessage,
		workspaceLabel,
		workspaceRootCwd,
	};
}

export type MainAppController = ReturnType<typeof useMainAppController>;
