import { useBetterAuthTauri } from "@daveyplate/better-auth-tauri/react";
import { useChatStore } from "@mobvibe/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
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
import { ApiKeysPage } from "@/pages/ApiKeysPage";
import { LoginPage } from "@/pages/LoginPage";
import { SettingsPage } from "@/pages/SettingsPage";

function MainApp() {
	const { t } = useTranslation();
	const [isForceReloading, setIsForceReloading] = useState(false);
	const {
		sessions,
		activeSessionId,
		appError,
		lastCreatedCwd,
		setActiveSessionId,
		setAppError,
		setLastCreatedCwd,
		setSessionLoading,
		markSessionAttached,
		markSessionDetached,
		createLocalSession,
		syncSessions,
		removeSession,
		renameSession: renameSessionLocal,
		setError,
		setInput,
		setInputContents,
		setSending,
		setCanceling,
		setStreamError,
		updateSessionMeta,
		addUserMessage,
		addStatusMessage,
		appendAssistantChunk,
		appendThoughtChunk,
		appendUserChunk,
		finalizeAssistantMessage,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		addToolCall,
		updateToolCall,
		appendTerminalOutput,
		handleSessionsChanged,
		clearSessionMessages,
		restoreSessionMessages,
		updateSessionCursor,
		resetSessionForRevision,
	} = useChatStore();
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
		setMobileMenuOpen,
		setCreateDialogOpen,
		setFileExplorerOpen,
		setFilePreviewPath,
		clearEditingSession,
		setDraftTitle,
		setDraftBackendId,
		setDraftCwd,
		setSelectedWorkspace,
	} = useUiStore();

	const {
		sessionsQuery,
		backendsQuery,
		availableBackends,
		defaultBackendId,
		discoverSessionsMutation,
	} = useSessionQueries();
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
		setActiveSessionId,
		setLastCreatedCwd,
		setSessionLoading,
		markSessionAttached,
		markSessionDetached,
		createLocalSession,
		syncSessions,
		removeSession,
		renameSession: renameSessionLocal,
		setError,
		setAppError,
		setInput,
		setInputContents,
		setSending,
		setCanceling,
		setStreamError,
		updateSessionMeta,
		addUserMessage,
		addStatusMessage,
		appendAssistantChunk,
		appendThoughtChunk,
		appendUserChunk,
		finalizeAssistantMessage,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		addToolCall,
		updateToolCall,
		appendTerminalOutput,
		handleSessionsChanged,
		clearSessionMessages,
		restoreSessionMessages,
		updateSessionCursor,
		resetSessionForRevision,
	});

	const { activateSession, isActivating } = useSessionActivation({
		sessions,
		setActiveSessionId,
		setLastCreatedCwd,
		setSessionLoading,
		markSessionAttached,
		markSessionDetached,
		createLocalSession,
		syncSessions,
		removeSession,
		renameSession: renameSessionLocal,
		setError,
		setAppError,
		setInput,
		setInputContents,
		setSending,
		setCanceling,
		setStreamError,
		updateSessionMeta,
		addUserMessage,
		addStatusMessage,
		appendAssistantChunk,
		appendThoughtChunk,
		appendUserChunk,
		finalizeAssistantMessage,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		addToolCall,
		updateToolCall,
		appendTerminalOutput,
		handleSessionsChanged,
		clearSessionMessages,
		restoreSessionMessages,
		updateSessionCursor,
		resetSessionForRevision,
	});

	const { syncSessionHistory, isBackfilling } = useSocket({
		sessions,
		appendAssistantChunk,
		appendThoughtChunk,
		appendUserChunk,
		updateSessionMeta,
		setStreamError,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		addToolCall,
		updateToolCall,
		appendTerminalOutput,
		handleSessionsChanged,
		markSessionAttached,
		markSessionDetached,
		createLocalSession,
		updateSessionCursor,
		resetSessionForRevision,
	});

	const { machines, selectedMachineId, setMachineCapabilities } =
		useMachinesStore();
	const discoveryInFlightRef = useRef(new Set<string>());
	const previousConnectionRef = useRef<Record<string, boolean>>({});

	const workspaceList = useMemo(
		() => collectWorkspaces(sessions, selectedMachineId),
		[sessions, selectedMachineId],
	);
	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
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
			syncSessions(sessionsQuery.data.sessions);
		}
	}, [sessionsQuery.data?.sessions, syncSessions]);

	useEffect(() => {
		ensureNotificationPermission();
	}, []);

	useEffect(() => {
		if (sessionList.length === 0) {
			if (activeSessionId) {
				setActiveSessionId(undefined);
			}
			return;
		}
		const isActiveInList = sessionList.some(
			(session) => session.sessionId === activeSessionId,
		);
		if (!isActiveInList) {
			setActiveSessionId(sessionList[0].sessionId);
		}
	}, [activeSessionId, sessionList, setActiveSessionId]);

	useEffect(() => {
		if (!activeSession?.machineId || !activeSession.cwd) {
			return;
		}
		setSelectedWorkspace(activeSession.machineId, activeSession.cwd);
	}, [activeSession?.cwd, activeSession?.machineId, setSelectedWorkspace]);

	useEffect(() => {
		if (!selectedMachineId) {
			return;
		}
		if (selectedWorkspaceCwd || workspaceList.length === 0) {
			return;
		}
		setSelectedWorkspace(selectedMachineId, workspaceList[0].cwd);
	}, [
		selectedMachineId,
		selectedWorkspaceCwd,
		setSelectedWorkspace,
		workspaceList,
	]);

	useEffect(() => {
		if (!createDialogOpen) {
			return;
		}
		if (!draftBackendId && defaultBackendId) {
			setDraftBackendId(defaultBackendId);
		}
	}, [createDialogOpen, defaultBackendId, draftBackendId, setDraftBackendId]);

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
		setFileExplorerOpen(false);
		setFilePreviewPath(undefined);
	}, [fileExplorerAvailable, setFileExplorerOpen, setFilePreviewPath]);

	const handleOpenCreateDialog = () => {
		setDraftTitle(buildSessionTitle(sessionList, t));
		setDraftBackendId(defaultBackendId);
		setDraftCwd(lastCreatedCwd);
		setCreateDialogOpen(true);
	};

	const handleCreateSession = async () => {
		if (!selectedMachineId) {
			setAppError(createFallbackError(t("errors.selectMachine"), "request"));
			return;
		}
		if (!draftBackendId) {
			setAppError(createFallbackError(t("errors.selectBackend"), "request"));
			return;
		}
		if (!draftCwd) {
			setAppError(createFallbackError(t("errors.selectDirectory"), "request"));
			return;
		}
		const title = draftTitle.trim();
		setAppError(undefined);
		try {
			await createSessionMutation.mutateAsync({
				backendId: draftBackendId,
				cwd: draftCwd,
				title: title.length > 0 ? title : undefined,
				machineId: selectedMachineId,
			});
			setCreateDialogOpen(false);
			setMobileMenuOpen(false);
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
		renameSessionLocal(editingSessionId, title);
		renameSessionMutation.mutate({ sessionId: editingSessionId, title });
		clearEditingSession();
	};

	const handleCloseSession = async (sessionId: string) => {
		try {
			await closeSessionMutation.mutateAsync({ sessionId });
			if (activeSessionId === sessionId) {
				const nextSession = sessionList.find(
					(session) => session.sessionId !== sessionId,
				);
				setActiveSessionId(nextSession?.sessionId);
			}
		} catch {
			return;
		}
	};

	const handlePermissionDecision = (payload: {
		requestId: string;
		outcome: PermissionResultNotification["outcome"];
	}) => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		if (!activeSession.isAttached) {
			setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		permissionDecisionMutation.mutate({
			sessionId: activeSessionId,
			requestId: payload.requestId,
			outcome: payload.outcome,
		});
	};

	const handleModeChange = (modeId: string) => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		if (!activeSession.isAttached) {
			setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		if (modeId === activeSession.modeId) {
			return;
		}
		setError(activeSessionId, undefined);
		setSessionModeMutation.mutate({ sessionId: activeSessionId, modeId });
	};

	const handleModelChange = (modelId: string) => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		if (!activeSession.isAttached) {
			setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		if (modelId === activeSession.modelId) {
			return;
		}
		setError(activeSessionId, undefined);
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
			setError(activeSessionId, buildSessionNotReadyError());
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
			setError(activeSessionId, buildSessionNotReadyError());
			return;
		}

		setSending(activeSessionId, true);
		setCanceling(activeSessionId, false);
		setError(activeSessionId, undefined);
		setInput(activeSessionId, "");
		setInputContents(activeSessionId, [{ type: "text", text: "" }]);

		let messageId: string;
		try {
			const response = await createMessageIdMutation.mutateAsync({
				sessionId: activeSessionId,
			});
			messageId = response.messageId;
		} catch {
			return;
		}

		addUserMessage(activeSessionId, activeSession.input ?? "", {
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
					onOpenChange={setCreateDialogOpen}
					availableBackends={availableBackends}
					isCreating={createSessionMutation.isPending}
					onCreate={handleCreateSession}
				/>
				<FileExplorerDialog
					open={fileExplorerOpen && fileExplorerAvailable}
					onOpenChange={(isOpen) => {
						setFileExplorerOpen(isOpen);
						if (!isOpen) {
							setFilePreviewPath(undefined);
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
							setActiveSessionId(sessionId);
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
						onOpenMobileMenu={() => setMobileMenuOpen(true)}
						onOpenFileExplorer={() => setFileExplorerOpen(true)}
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
							<ApiKeysPage />
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
							<SettingsPage />
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
								<LoginPage
									onSuccess={() => {
										const params = new URLSearchParams(window.location.search);
										const returnUrl = params.get("returnUrl");
										if (returnUrl) {
											window.location.href = returnUrl;
										} else {
											navigate("/");
										}
									}}
								/>
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
