import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app/AppHeader";
import { AppSidebar } from "@/components/app/AppSidebar";
import { ChatFooter } from "@/components/app/ChatFooter";
import { ChatMessageList } from "@/components/app/ChatMessageList";
import { CreateSessionDialog } from "@/components/app/CreateSessionDialog";
import { Separator } from "@/components/ui/separator";
import { useMessageAutoScroll } from "@/hooks/useMessageAutoScroll";
import { useSessionEventSources } from "@/hooks/useSessionEventSources";
import { useSessionMutations } from "@/hooks/useSessionMutations";
import { useSessionQueries } from "@/hooks/useSessionQueries";
import type { PermissionResultNotification } from "@/lib/acp";
import type { ChatSession } from "@/lib/chat-store";
import { useChatStore } from "@/lib/chat-store";
import {
	buildSessionNotReadyError,
	createFallbackError,
	normalizeError,
} from "@/lib/error-utils";
import { buildSessionTitle, getStatusVariant } from "@/lib/ui-utils";

export function App() {
	const {
		sessions,
		activeSessionId,
		appError,
		setActiveSessionId,
		setAppError,
		createLocalSession,
		syncSessions,
		removeSession,
		renameSession: renameSessionLocal,
		setInput,
		setSending,
		setCanceling,
		setError,
		setStreamError,
		updateSessionMeta,
		addUserMessage,
		addStatusMessage,
		appendAssistantChunk,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
		finalizeAssistantMessage,
	} = useChatStore();
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [draftTitle, setDraftTitle] = useState("");
	const [draftBackendId, setDraftBackendId] = useState<string | undefined>();
	const [draftCwd, setDraftCwd] = useState<string | undefined>();

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
		setActiveSessionId,
		createLocalSession,
		syncSessions,
		removeSession,
		renameSession: renameSessionLocal,
		setError,
		setAppError,
		setInput,
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
	});

	useSessionEventSources({
		sessions,
		appendAssistantChunk,
		updateSessionMeta,
		setStreamError,
		addPermissionRequest,
		setPermissionDecisionState,
		setPermissionOutcome,
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
	}, [createDialogOpen, defaultBackendId, draftBackendId]);

	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
	const activeSessionState = activeSession?.state;

	const { messageListRef, endOfMessagesRef, handleMessagesScroll } =
		useMessageAutoScroll(activeSessionId, activeSession?.messages ?? []);

	const handleOpenCreateDialog = () => {
		setDraftTitle(buildSessionTitle(sessionList));
		setDraftBackendId(defaultBackendId);
		setDraftCwd(undefined);
		setCreateDialogOpen(true);
	};

	const handleCreateSession = async () => {
		if (!draftBackendId) {
			setAppError(createFallbackError("请选择后端", "request"));
			return;
		}
		if (!draftCwd) {
			setAppError(createFallbackError("请选择工作目录", "request"));
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

	const handleRenameStart = (session: ChatSession) => {
		setEditingSessionId(session.sessionId);
		setEditingTitle(session.title);
	};

	const handleRenameCancel = () => {
		setEditingSessionId(null);
		setEditingTitle("");
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
		setEditingSessionId(null);
		setEditingTitle("");
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
		const prompt = activeSession.input.trim();
		if (!prompt || activeSession.sending) {
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

		let messageId: string;
		try {
			const response = await createMessageIdMutation.mutateAsync({
				sessionId: activeSessionId,
			});
			messageId = response.messageId;
		} catch {
			return;
		}

		addUserMessage(activeSessionId, prompt, { messageId });
		sendMessageMutation.mutate({ sessionId: activeSessionId, prompt });
	};

	const handleInputChange = (value: string) => {
		if (!activeSessionId) {
			return;
		}
		setInput(activeSessionId, value);
	};

	const statusVariant = getStatusVariant(activeSessionState);
	const statusLabel = activeSessionState ?? "idle";

	const statusMessage = useMemo(() => {
		if (backendsQuery.isError) {
			return normalizeError(
				backendsQuery.error,
				createFallbackError("后端列表获取失败", "service"),
			).message;
		}
		if (sessionsQuery.isError) {
			return normalizeError(
				sessionsQuery.error,
				createFallbackError("会话列表获取失败", "service"),
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
		<div className="app-root bg-muted/40 text-foreground flex flex-col overflow-hidden md:flex-row">
			<CreateSessionDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				draftTitle={draftTitle}
				onDraftTitleChange={setDraftTitle}
				draftBackendId={draftBackendId}
				onDraftBackendChange={setDraftBackendId}
				draftCwd={draftCwd}
				onDraftCwdChange={setDraftCwd}
				availableBackends={availableBackends}
				isCreating={createSessionMutation.isPending}
				onCreate={handleCreateSession}
			/>

			<AppSidebar
				sessions={sessionList}
				activeSessionId={activeSessionId}
				editingSessionId={editingSessionId}
				editingTitle={editingTitle}
				onCreateSession={handleOpenCreateDialog}
				onSelectSession={setActiveSessionId}
				onEditSession={handleRenameStart}
				onEditCancel={handleRenameCancel}
				onEditSubmit={handleRenameSubmit}
				onEditingTitleChange={setEditingTitle}
				onCloseSession={(sessionId) => {
					void handleCloseSession(sessionId);
				}}
				isCreating={createSessionMutation.isPending}
				mobileOpen={mobileMenuOpen}
				onMobileOpenChange={setMobileMenuOpen}
			/>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<AppHeader
					statusVariant={statusVariant}
					statusLabel={statusLabel}
					backendLabel={backendLabel}
					statusMessage={statusMessage}
					streamError={streamError}
					onOpenMobileMenu={() => setMobileMenuOpen(true)}
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
					onInputChange={handleInputChange}
				/>
			</div>
		</div>
	);
}

export default App;
