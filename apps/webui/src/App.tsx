import { useBetterAuthTauri } from "@daveyplate/better-auth-tauri/react";
import { useEffect, useMemo } from "react";
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
import { useMessageAutoScroll } from "@/hooks/useMessageAutoScroll";
import { useSessionMutations } from "@/hooks/useSessionMutations";
import { useSessionQueries } from "@/hooks/useSessionQueries";
import { useSocket } from "@/hooks/useSocket";
import type { PermissionResultNotification } from "@/lib/acp";
import { getAuthClient, isInTauri } from "@/lib/auth";
import { useChatStore } from "@/lib/chat-store";
import {
	buildSessionNotReadyError,
	createFallbackError,
	normalizeError,
} from "@/lib/error-utils";
import { ensureNotificationPermission } from "@/lib/notifications";
import { useUiStore } from "@/lib/ui-store";
import { buildSessionTitle, getStatusVariant } from "@/lib/ui-utils";
import { LoginPage } from "@/pages/LoginPage";
import { MachineCallbackPage } from "@/pages/MachineCallbackPage";

function MainApp() {
	const { t } = useTranslation();
	const {
		sessions,
		activeSessionId,
		appError,
		lastCreatedCwd,
		setActiveSessionId,
		setAppError,
		setLastCreatedCwd,
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
		finalizeAssistantMessage,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		addToolCall,
		updateToolCall,
		appendTerminalOutput,
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
		setMobileMenuOpen,
		setCreateDialogOpen,
		setFileExplorerOpen,
		setFilePreviewPath,
		clearEditingSession,
		setDraftTitle,
		setDraftBackendId,
		setDraftCwd,
	} = useUiStore();

	const { sessionsQuery, backendsQuery, availableBackends, defaultBackendId } =
		useSessionQueries();

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
		finalizeAssistantMessage,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		addToolCall,
		updateToolCall,
		appendTerminalOutput,
	});

	useSocket({
		sessions,
		appendAssistantChunk,
		updateSessionMeta,
		setStreamError,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		addToolCall,
		updateToolCall,
		appendTerminalOutput,
	});

	const sessionList = useMemo(() => {
		return Object.values(sessions).sort((left, right) => {
			const leftStamp = left.updatedAt ?? left.createdAt ?? "";
			const rightStamp = right.updatedAt ?? right.createdAt ?? "";
			return rightStamp.localeCompare(leftStamp);
		});
	}, [sessions]);

	useEffect(() => {
		if (sessionsQuery.data?.sessions) {
			syncSessions(sessionsQuery.data.sessions);
		}
	}, [sessionsQuery.data?.sessions, syncSessions]);

	useEffect(() => {
		ensureNotificationPermission();
	}, []);

	useEffect(() => {
		if (activeSessionId || sessionList.length === 0) {
			return;
		}
		setActiveSessionId(sessionList[0].sessionId);
	}, [activeSessionId, sessionList, setActiveSessionId]);

	useEffect(() => {
		if (!createDialogOpen) {
			return;
		}
		if (!draftBackendId && defaultBackendId) {
			setDraftBackendId(defaultBackendId);
		}
	}, [createDialogOpen, defaultBackendId, draftBackendId, setDraftBackendId]);

	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
	const activeSessionState = activeSession?.state;
	const fileExplorerAvailable = Boolean(activeSessionId && activeSession?.cwd);

	useEffect(() => {
		if (fileExplorerAvailable) {
			return;
		}
		setFileExplorerOpen(false);
		setFilePreviewPath(undefined);
	}, [fileExplorerAvailable, setFileExplorerOpen, setFilePreviewPath]);

	const { messageListRef, endOfMessagesRef, handleMessagesScroll } =
		useMessageAutoScroll(activeSessionId, activeSession?.messages ?? []);

	const handleOpenCreateDialog = () => {
		setDraftTitle(buildSessionTitle(sessionList, t));
		setDraftBackendId(defaultBackendId);
		setDraftCwd(lastCreatedCwd);
		setCreateDialogOpen(true);
	};

	const handleCreateSession = async () => {
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
		if (activeSession.state !== "ready") {
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
		if (activeSession.state !== "ready") {
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
		if (activeSession.state !== "ready") {
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
		if (activeSession.state !== "ready") {
			setError(activeSessionId, buildSessionNotReadyError());
			return;
		}
		cancelSessionMutation.mutate({ sessionId: activeSessionId });
	};

	const handleSend = async () => {
		if (!activeSessionId || !activeSession) {
			return;
		}
		const promptContents = activeSession.inputContents;
		if (!promptContents.length || activeSession.sending) {
			return;
		}
		if (activeSession.state !== "ready") {
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

	const statusVariant = getStatusVariant(activeSessionState);
	const statusLabel = t(`status.${activeSessionState ?? "idle"}`, {
		defaultValue: activeSessionState ?? "idle",
	});

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
					onSelectSession={setActiveSessionId}
					onEditSubmit={handleRenameSubmit}
					onCloseSession={(sessionId) => {
						void handleCloseSession(sessionId);
					}}
					isCreating={createSessionMutation.isPending}
				/>

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<AppHeader
						statusVariant={statusVariant}
						statusLabel={statusLabel}
						backendLabel={backendLabel}
						statusMessage={statusMessage}
						streamError={streamError}
						onOpenMobileMenu={() => setMobileMenuOpen(true)}
						onOpenFileExplorer={() => setFileExplorerOpen(true)}
						showFileExplorer={fileExplorerAvailable}
					/>
					<ChatMessageList
						activeSession={activeSession}
						onPermissionDecision={handlePermissionDecision}
						messageListRef={messageListRef}
						endOfMessagesRef={endOfMessagesRef}
						onMessagesScroll={handleMessagesScroll}
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
				{/* Machine registration callback from CLI login */}
				<Route
					path="/auth/machine-callback"
					element={<MachineCallbackPage />}
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
