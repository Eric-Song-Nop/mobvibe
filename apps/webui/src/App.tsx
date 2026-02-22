import { useBetterAuthTauri } from "@daveyplate/better-auth-tauri/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { AppHeader } from "@/components/app/AppHeader";
import { AppSidebar } from "@/components/app/AppSidebar";
import { ChatFooter } from "@/components/app/ChatFooter";
import { ChatMessageList } from "@/components/app/ChatMessageList";
import { CreateSessionDialog } from "@/components/app/CreateSessionDialog";
import { FileExplorerDialog } from "@/components/app/FileExplorerDialog";
import { useAuth } from "@/components/auth/AuthProvider";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";
import { MachinesSidebar } from "@/components/machines/MachinesSidebar";
import { parsePairingUrl } from "@/components/settings/E2EESettings";
import { ThemeProvider } from "@/components/theme-provider";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/toaster";
import { useMachineDiscovery } from "@/hooks/useMachineDiscovery";
import { useMachinesQuery } from "@/hooks/useMachinesQuery";
import { useSessionActivation } from "@/hooks/useSessionActivation";
import { useSessionHandlers } from "@/hooks/useSessionHandlers";
import { useSessionList } from "@/hooks/useSessionList";
import { useSessionMutations } from "@/hooks/useSessionMutations";
import { useSessionQueries } from "@/hooks/useSessionQueries";
import { useSocket } from "@/hooks/useSocket";
import { getAuthClient, isInTauri } from "@/lib/auth";
import { useChatStore } from "@/lib/chat-store";
import { e2ee } from "@/lib/e2ee";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { isInputFocused, registerHotkeys } from "@/lib/hotkeys";
import { getBackendCapability, useMachinesStore } from "@/lib/machines-store";
import { ensureNotificationPermission } from "@/lib/notifications";
import { useUiStore } from "@/lib/ui-store";

const CommandPalette = lazy(async () => {
	const module = await import("@/components/app/CommandPalette");
	return { default: module.CommandPalette };
});

const SettingsPage = lazy(async () => {
	const module = await import("@/pages/SettingsPage");
	return { default: module.SettingsPage };
});

const LoginPage = lazy(async () => {
	const module = await import("@/pages/LoginPage");
	return { default: module.LoginPage };
});

function MainApp() {
	const { t } = useTranslation();

	// Reactive state — re-renders only when these values change
	const { sessions, activeSessionId, appError, lastCreatedCwd } = useChatStore(
		useShallow((s) => ({
			sessions: s.sessions,
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
			markSessionAttached: s.markSessionAttached,
			markSessionDetached: s.markSessionDetached,
			createLocalSession: s.createLocalSession,
			syncSessions: s.syncSessions,
			removeSession: s.removeSession,
			renameSession: s.renameSession,
			setError: s.setError,
			setInput: s.setInput,
			setInputContents: s.setInputContents,
			setSending: s.setSending,
			setCanceling: s.setCanceling,
			setStreamError: s.setStreamError,
			updateSessionMeta: s.updateSessionMeta,
			addUserMessage: s.addUserMessage,
			addStatusMessage: s.addStatusMessage,
			appendAssistantChunk: s.appendAssistantChunk,
			appendThoughtChunk: s.appendThoughtChunk,
			appendUserChunk: s.appendUserChunk,
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
			resetDraftWorktree: s.resetDraftWorktree,
			setSelectedWorkspace: s.setSelectedWorkspace,
		})),
	);

	const {
		sessionsQuery,
		backendsQuery,
		availableBackends,
		discoverSessionsMutation,
	} = useSessionQueries();
	const defaultBackendId = availableBackends[0]?.backendId;
	useMachinesQuery();

	const mutations = useSessionMutations({
		sessions,
		...chatActions,
	});

	const { activateSession, activationState } = useSessionActivation({
		sessions,
		...chatActions,
	});

	const isActivating = activationState.phase !== "idle";

	const { syncSessionHistory, isBackfilling } = useSocket({
		sessions,
		setSending: chatActions.setSending,
		setCanceling: chatActions.setCanceling,
		finalizeAssistantMessage: chatActions.finalizeAssistantMessage,
		appendAssistantChunk: chatActions.appendAssistantChunk,
		appendThoughtChunk: chatActions.appendThoughtChunk,
		appendUserChunk: chatActions.appendUserChunk,
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
	});

	const { machines, selectedMachineId } = useMachinesStore(
		useShallow((s) => ({
			machines: s.machines,
			selectedMachineId: s.selectedMachineId,
		})),
	);
	const updateBackendCapabilities = useMachinesStore(
		(s) => s.updateBackendCapabilities,
	);

	// --- Extracted hooks ---

	const { workspaceList, activeSession, selectedWorkspaceCwd, sessionList } =
		useSessionList({
			sessions,
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
	} = useSessionHandlers({
		sessions,
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
	});

	// --- Effects ---

	useEffect(() => {
		if (sessionsQuery.data?.sessions) {
			// Unwrap DEKs from initial session list
			if (e2ee.isEnabled()) {
				for (const session of sessionsQuery.data.sessions) {
					if (session.wrappedDek) {
						e2ee.unwrapSessionDek(session.sessionId, session.wrappedDek);
					}
				}
			}
			chatActions.syncSessions(sessionsQuery.data.sessions);

			// Set E2EE status for all sessions (independent of e2ee.isEnabled)
			const { setSessionE2EEStatus } = useChatStore.getState();
			for (const session of sessionsQuery.data.sessions) {
				setSessionE2EEStatus(
					session.sessionId,
					e2ee.getSessionE2EEStatus(
						session.sessionId,
						Boolean(session.wrappedDek),
					),
				);
			}
		}
	}, [sessionsQuery.data?.sessions, chatActions.syncSessions]);

	useEffect(() => {
		ensureNotificationPermission();
	}, []);

	useEffect(() => {
		if (sessionList.length === 0) {
			if (activeSessionId) {
				chatActions.setActiveSessionId(undefined);
			}
			return;
		}
		const isActiveInList = sessionList.some(
			(session) => session.sessionId === activeSessionId,
		);
		if (!isActiveInList) {
			chatActions.setActiveSessionId(sessionList[0].sessionId);
		}
	}, [activeSessionId, sessionList, chatActions.setActiveSessionId]);

	useEffect(() => {
		if (!activeSession?.machineId || !activeSession.cwd) {
			return;
		}
		const workspaceCwd = activeSession.worktreeSourceCwd || activeSession.cwd;
		uiActions.setSelectedWorkspace(activeSession.machineId, workspaceCwd);
	}, [
		activeSession?.cwd,
		activeSession?.machineId,
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
				key: "p",
				mod: true,
				handler: () => {
					uiActions.setCommandPaletteOpen(true);
					// Mode will be set to "@" by CommandPalette when it detects this
					// via initialMode prop
				},
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

	// --- Derived display state ---

	const fileExplorerAvailable = Boolean(activeSessionId && activeSession?.cwd);
	const syncHistoryAvailable = Boolean(activeSessionId);
	const syncHistoryDisabled =
		!syncHistoryAvailable ||
		Boolean(
			activeSession?.isLoading ||
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
		Boolean(activeSession?.isLoading || isActivating || isForceReloading);

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
		return undefined;
	}, [
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
	const isModeSwitching =
		mutations.setSessionModeMutation.isPending &&
		mutations.setSessionModeMutation.variables?.sessionId === activeSessionId;
	const isModelSwitching =
		mutations.setSessionModelMutation.isPending &&
		mutations.setSessionModelMutation.variables?.sessionId === activeSessionId;

	return (
		<ThemeProvider>
			<div className="app-root bg-muted/40 text-foreground flex flex-col overflow-hidden md:flex-row">
				<Toaster />
				<CreateSessionDialog
					open={createDialogOpen}
					onOpenChange={uiActions.setCreateDialogOpen}
					availableBackends={availableBackends}
					isCreating={mutations.createSessionMutation.isPending}
					onCreate={handleCreateSession}
				/>
				<FileExplorerDialog
					open={fileExplorerOpen && fileExplorerAvailable}
					onOpenChange={(isOpen) => {
						uiActions.setFileExplorerOpen(isOpen);
						if (!isOpen) {
							uiActions.setFilePreviewPath(undefined);
						}
					}}
					sessionId={activeSessionId}
					initialFilePath={filePreviewPath}
				/>
				<Suspense fallback={null}>
					{commandPaletteOpen ? (
						<CommandPalette
							open={commandPaletteOpen}
							onOpenChange={uiActions.setCommandPaletteOpen}
							onOpenFileExplorer={() => uiActions.setFileExplorerOpen(true)}
							onCreateSession={handleOpenCreateDialog}
							onOpenChatSearch={() => uiActions.setChatSearchOpen(true)}
							activeSessionId={activeSessionId}
						/>
					) : null}
				</Suspense>

				<MachinesSidebar />

				<AppSidebar
					sessions={sessionList}
					activeSessionId={activeSessionId}
					onCreateSession={handleOpenCreateDialog}
					onSelectSession={(sessionId) => {
						const session = sessions[sessionId];
						if (session) {
							void activateSession(session);
						} else {
							chatActions.setActiveSessionId(sessionId);
						}
					}}
					onEditSubmit={handleRenameSubmit}
					onArchiveSession={(sessionId) => {
						void handleArchiveSession(sessionId);
					}}
					onArchiveAllSessions={(sessionIds) => {
						void handleBulkArchiveSessions(sessionIds);
					}}
					isBulkArchiving={isBulkArchiving}
					isCreating={mutations.createSessionMutation.isPending}
					mutations={mutationsSnapshot}
				/>

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<AppHeader
						backendLabel={backendLabel}
						statusMessage={statusMessage}
						streamError={streamError}
						loadingMessage={loadingMessage}
						onOpenMobileMenu={() => uiActions.setMobileMenuOpen(true)}
						onOpenFileExplorer={() => uiActions.setFileExplorerOpen(true)}
						onOpenCommandPalette={() => uiActions.setCommandPaletteOpen(true)}
						onSyncHistory={handleSyncHistory}
						onForceReload={handleForceReload}
						showFileExplorer={fileExplorerAvailable}
						showSyncHistory={syncHistoryAvailable}
						showForceReload={Boolean(activeSessionId)}
						syncHistoryDisabled={syncHistoryDisabled}
						forceReloadDisabled={forceReloadDisabled}
					/>
					<ChatSearchBar
						open={chatSearchOpen}
						onOpenChange={uiActions.setChatSearchOpen}
						messages={activeSession?.messages ?? []}
						onScrollToMessage={handleScrollToMessage}
					/>
					<ChatMessageList
						ref={chatMessageListRef}
						activeSession={activeSession}
						loadingMessage={loadingMessage}
						hasMachineSelected={Boolean(selectedMachineId)}
						onCreateSession={handleOpenCreateDialog}
						onPermissionDecision={handlePermissionDecision}
					/>
					<Separator />
					<ChatFooter
						activeSession={activeSession}
						activeSessionId={activeSessionId}
						isModeSwitching={isModeSwitching}
						isModelSwitching={isModelSwitching}
						onModeChange={handleModeChange}
						onModelChange={handleModelChange}
						onSend={handleSend}
						onCancel={handleCancel}
					/>
				</div>
			</div>
		</ThemeProvider>
	);
}

/**
 * Component to handle Tauri deep link auth callbacks.
 * Extracted to avoid conditional hook calls in App.
 */
function TauriAuthHandler({
	authClient,
}: {
	authClient: NonNullable<ReturnType<typeof getAuthClient>>;
}) {
	useBetterAuthTauri({
		authClient,
		scheme: "mobvibe",
		onSuccess: (url) => {
			if (url) {
				window.location.href = url;
			}
		},
	});
	return null;
}

/**
 * Component to handle `mobvibe://pair?secret=...` deep links.
 * Automatically pairs E2EE when the app is opened via a pairing URL.
 */
function TauriPairHandler() {
	const unlistenRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
				const unlisten = await onOpenUrl((urls) => {
					for (const url of urls) {
						const secret = parsePairingUrl(url);
						if (secret) {
							void e2ee.setPairedSecret(secret);
							break;
						}
					}
				});
				if (cancelled) {
					unlisten();
				} else {
					unlistenRef.current = unlisten;
				}
			} catch {
				// Deep-link plugin not available (e.g. browser build)
			}
		})();

		return () => {
			cancelled = true;
			unlistenRef.current?.();
		};
	}, []);

	return null;
}

function RoutePending() {
	return (
		<div className="text-muted-foreground flex min-h-screen items-center justify-center bg-muted/40">
			Loading…
		</div>
	);
}

export function App() {
	const { isAuthenticated, isLoading, isAuthEnabled } = useAuth();
	const navigate = useNavigate();

	// Handle Tauri deep link auth callbacks
	const authClient = getAuthClient();
	const shouldSetupTauriAuth = isInTauri() && authClient !== null;
	const shouldSetupTauriPair = isInTauri();

	// Show loading state while checking auth
	if (isLoading) {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40">
					<div className="text-muted-foreground">Loading…</div>
				</div>
			</ThemeProvider>
		);
	}

	return (
		<>
			{shouldSetupTauriAuth && <TauriAuthHandler authClient={authClient!} />}
			{shouldSetupTauriPair && <TauriPairHandler />}
			<Routes>
				{/* Settings page */}
				<Route
					path="/settings"
					element={
						!isAuthEnabled || isAuthenticated ? (
							<Suspense fallback={<RoutePending />}>
								<SettingsPage />
							</Suspense>
						) : (
							<Navigate to="/login?returnUrl=/settings" replace />
						)
					}
				/>

				{/* Login page */}
				<Route
					path="/login"
					element={
						isAuthenticated || !isAuthEnabled ? (
							<Navigate to="/" replace />
						) : (
							<ThemeProvider>
								<Suspense fallback={<RoutePending />}>
									<LoginPage
										onSuccess={() => {
											const params = new URLSearchParams(
												window.location.search,
											);
											const returnUrl = params.get("returnUrl");
											if (returnUrl) {
												window.location.href = returnUrl;
											} else {
												navigate("/");
											}
										}}
									/>
								</Suspense>
							</ThemeProvider>
						)
					}
				/>

				{/* Main app - requires auth when enabled */}
				<Route
					path="/*"
					element={
						!isAuthEnabled || isAuthenticated ? (
							<MainApp />
						) : (
							<Navigate to="/login" replace />
						)
					}
				/>
			</Routes>
		</>
	);
}

export default App;
