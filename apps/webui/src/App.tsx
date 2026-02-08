import { useBetterAuthTauri } from "@daveyplate/better-auth-tauri/react";
import { useChatStore } from "@mobvibe/core";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
import { MachinesSidebar } from "@/components/machines/MachinesSidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/toaster";
import { useMachinesQuery } from "@/hooks/useMachinesQuery";
import { useMachinesStream } from "@/hooks/useMachinesStream";
import { useSessionActivation } from "@/hooks/useSessionActivation";
import { useSessionMutations } from "@/hooks/useSessionMutations";
import { useSessionQueries } from "@/hooks/useSessionQueries";
import { useSocket } from "@/hooks/useSocket";
import type { PermissionResultNotification } from "@/lib/acp";
import { getAuthClient, isInTauri } from "@/lib/auth";
import {
	buildSessionNotReadyError,
	createFallbackError,
	normalizeError,
} from "@/lib/error-utils";
import { useMachinesStore } from "@/lib/machines-store";
import { ensureNotificationPermission } from "@/lib/notifications";
import { useUiStore } from "@/lib/ui-store";
import { buildSessionTitle } from "@/lib/ui-utils";
import { collectWorkspaces } from "@/lib/workspace-utils";

const ApiKeysPage = lazy(async () => {
	const module = await import("@/pages/ApiKeysPage");
	return { default: module.ApiKeysPage };
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
	const [isForceReloading, setIsForceReloading] = useState(false);

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
		editingSessionId,
		editingTitle,
		draftTitle,
		draftBackendId,
		draftCwd,
		selectedWorkspaceByMachine,
	} = useUiStore(
		useShallow((s) => ({
			createDialogOpen: s.createDialogOpen,
			fileExplorerOpen: s.fileExplorerOpen,
			filePreviewPath: s.filePreviewPath,
			editingSessionId: s.editingSessionId,
			editingTitle: s.editingTitle,
			draftTitle: s.draftTitle,
			draftBackendId: s.draftBackendId,
			draftCwd: s.draftCwd,
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
			clearEditingSession: s.clearEditingSession,
			setDraftTitle: s.setDraftTitle,
			setDraftBackendId: s.setDraftBackendId,
			setDraftCwd: s.setDraftCwd,
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
	useMachinesStream();

	const {
		createSessionMutation,
		renameSessionMutation,
		closeSessionMutation,
		cancelSessionMutation,
		setSessionModeMutation,
		setSessionModelMutation,
		sendMessageMutation,
		createMessageIdMutation,
		permissionDecisionMutation,
	} = useSessionMutations({
		sessions,
		...chatActions,
	});

	const { activateSession, isActivating } = useSessionActivation({
		sessions,
		...chatActions,
	});

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
	const { setMachineCapabilities } = useMachinesStore(
		useShallow((s) => ({
			setMachineCapabilities: s.setMachineCapabilities,
		})),
	);
	const discoveryInFlightRef = useRef(new Set<string>());
	const previousConnectionRef = useRef<Record<string, boolean>>({});

	const workspaceList = useMemo(
		() => collectWorkspaces(sessions, selectedMachineId),
		[sessions, selectedMachineId],
	);
	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
	const activeSessionRef = useRef(activeSession);
	activeSessionRef.current = activeSession;
	const activeWorkspaceCwd =
		activeSession?.machineId === selectedMachineId
			? activeSession.cwd
			: undefined;
	const selectedWorkspaceCwd = selectedMachineId
		? selectedWorkspaceByMachine[selectedMachineId]
		: undefined;
	const effectiveWorkspaceCwd =
		activeWorkspaceCwd ?? selectedWorkspaceCwd ?? workspaceList[0]?.cwd;

	useEffect(() => {
		const previous = previousConnectionRef.current;

		for (const machine of Object.values(machines)) {
			const wasConnected = previous[machine.machineId];
			previous[machine.machineId] = machine.connected;

			if (!machine.connected) {
				continue;
			}
			if (machine.lastCapabilitiesAt && wasConnected) {
				continue;
			}
			if (discoveryInFlightRef.current.has(machine.machineId)) {
				continue;
			}
			const workspaceCwd = selectedWorkspaceByMachine[machine.machineId];
			if (!workspaceCwd) {
				continue;
			}

			discoveryInFlightRef.current.add(machine.machineId);
			discoverSessionsMutation.mutate(
				{ machineId: machine.machineId, cwd: workspaceCwd },
				{
					onSuccess: (result) => {
						setMachineCapabilities(machine.machineId, result.capabilities);
					},
					onSettled: () => {
						discoveryInFlightRef.current.delete(machine.machineId);
					},
				},
			);
		}
	}, [
		discoverSessionsMutation,
		machines,
		selectedWorkspaceByMachine,
		setMachineCapabilities,
	]);

	const sessionList = useMemo(() => {
		const allSessions = Object.values(sessions);
		const filtered = selectedMachineId
			? allSessions.filter((s) => {
					if (s.machineId !== selectedMachineId) {
						return false;
					}
					if (effectiveWorkspaceCwd) {
						return s.cwd === effectiveWorkspaceCwd;
					}
					return true;
				})
			: [];
		return filtered.sort((left, right) => {
			const leftStamp = left.updatedAt ?? left.createdAt ?? "";
			const rightStamp = right.updatedAt ?? right.createdAt ?? "";
			return rightStamp.localeCompare(leftStamp);
		});
	}, [effectiveWorkspaceCwd, sessions, selectedMachineId]);

	useEffect(() => {
		if (sessionsQuery.data?.sessions) {
			chatActions.syncSessions(sessionsQuery.data.sessions);
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
		uiActions.setSelectedWorkspace(activeSession.machineId, activeSession.cwd);
	}, [
		activeSession?.cwd,
		activeSession?.machineId,
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
			machines[activeSession.machineId]?.capabilities?.load,
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

	const handleOpenCreateDialog = () => {
		uiActions.setDraftTitle(buildSessionTitle(sessionList, t));
		uiActions.setDraftBackendId(defaultBackendId);
		uiActions.setDraftCwd(
			selectedMachineId ? lastCreatedCwd[selectedMachineId] : undefined,
		);
		uiActions.setCreateDialogOpen(true);
	};

	const handleCreateSession = async () => {
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
			await createSessionMutation.mutateAsync({
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
		if (!editingSessionId) {
			return;
		}
		const title = editingTitle.trim();
		if (title.length === 0) {
			return;
		}
		chatActions.renameSession(editingSessionId, title);
		renameSessionMutation.mutate({ sessionId: editingSessionId, title });
		uiActions.clearEditingSession();
	};

	const handleCloseSession = async (sessionId: string) => {
		try {
			await closeSessionMutation.mutateAsync({ sessionId });
			if (activeSessionId === sessionId) {
				const nextSession = sessionList.find(
					(session) => session.sessionId !== sessionId,
				);
				chatActions.setActiveSessionId(nextSession?.sessionId);
			}
		} catch {
			return;
		}
	};

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
			permissionDecisionMutation.mutate({
				sessionId,
				requestId: payload.requestId,
				outcome: payload.outcome,
			});
		},
		[permissionDecisionMutation, chatActions.setError],
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
		setSessionModeMutation.mutate({ sessionId: activeSessionId, modeId });
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
		setSessionModelMutation.mutate({ sessionId: activeSessionId, modelId });
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
		cancelSessionMutation.mutate({ sessionId: activeSessionId });
	};

	const handleForceReload = async () => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		const capabilities = activeSession.machineId
			? machines[activeSession.machineId]?.capabilities
			: undefined;
		if (!activeSession.cwd || !activeSession.machineId || !capabilities?.load) {
			return;
		}
		if (activeSession.isLoading || isActivating || isForceReloading) {
			return;
		}

		setIsForceReloading(true);
		try {
			if (activeSession.sending && !activeSession.canceling) {
				if (activeSession.isAttached) {
					await cancelSessionMutation.mutateAsync({
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
			const response = await createMessageIdMutation.mutateAsync({
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
		sendMessageMutation.mutate({
			sessionId: activeSessionId,
			prompt: promptContents,
		});
	};

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

	const loadingMessage = activeSession?.isLoading
		? isForceReloading
			? t("session.reloadingHistory")
			: t("session.loadingHistory")
		: undefined;
	const streamError = activeSession?.streamError;
	const backendLabel = activeSession?.backendLabel ?? activeSession?.backendId;
	const isModeSwitching =
		setSessionModeMutation.isPending &&
		setSessionModeMutation.variables?.sessionId === activeSessionId;
	const isModelSwitching =
		setSessionModelMutation.isPending &&
		setSessionModelMutation.variables?.sessionId === activeSessionId;

	return (
		<ThemeProvider>
			<div className="app-root bg-muted/40 text-foreground flex flex-col overflow-hidden md:flex-row">
				<Toaster />
				<CreateSessionDialog
					open={createDialogOpen}
					onOpenChange={uiActions.setCreateDialogOpen}
					availableBackends={availableBackends}
					isCreating={createSessionMutation.isPending}
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
					onCloseSession={(sessionId) => {
						void handleCloseSession(sessionId);
					}}
					isCreating={createSessionMutation.isPending}
					isActivating={isActivating}
				/>

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<AppHeader
						backendLabel={backendLabel}
						statusMessage={statusMessage}
						streamError={streamError}
						loadingMessage={loadingMessage}
						onOpenMobileMenu={() => uiActions.setMobileMenuOpen(true)}
						onOpenFileExplorer={() => uiActions.setFileExplorerOpen(true)}
						onSyncHistory={handleSyncHistory}
						onForceReload={handleForceReload}
						showFileExplorer={fileExplorerAvailable}
						showSyncHistory={syncHistoryAvailable}
						showForceReload={Boolean(activeSessionId)}
						syncHistoryDisabled={syncHistoryDisabled}
						forceReloadDisabled={forceReloadDisabled}
					/>
					<ChatMessageList
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

function RoutePending() {
	return (
		<div className="text-muted-foreground flex min-h-screen items-center justify-center bg-muted/40">
			Loading...
		</div>
	);
}

export function App() {
	const { isAuthenticated, isLoading, isAuthEnabled } = useAuth();
	const navigate = useNavigate();

	// Handle Tauri deep link auth callbacks
	const authClient = getAuthClient();
	const shouldSetupTauriAuth = isInTauri() && authClient !== null;

	// Show loading state while checking auth
	if (isLoading) {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40">
					<div className="text-muted-foreground">Loading...</div>
				</div>
			</ThemeProvider>
		);
	}

	return (
		<>
			{shouldSetupTauriAuth && <TauriAuthHandler authClient={authClient!} />}
			<Routes>
				{/* API Keys page */}
				<Route
					path="/api-keys"
					element={
						!isAuthEnabled || isAuthenticated ? (
							<Suspense fallback={<RoutePending />}>
								<ApiKeysPage />
							</Suspense>
						) : (
							<Navigate to="/login?returnUrl=/api-keys" replace />
						)
					}
				/>

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
