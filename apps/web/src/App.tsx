import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageItem } from "@/components/chat/MessageItem";
import { SessionSidebar } from "@/components/session/SessionSidebar";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	type SessionNotification,
} from "@/lib/acp";
import {
	ApiError,
	closeSession,
	createSession,
	createSessionEventSource,
	type ErrorDetail,
	fetchAcpBackends,
	fetchSessions,
	renameSession,
	sendMessage,
} from "@/lib/api";
import {
	type ChatMessage,
	type ChatSession,
	useChatStore,
} from "@/lib/chat-store";

const createFallbackError = (
	message: string,
	scope: ErrorDetail["scope"],
): ErrorDetail => ({
	code: "INTERNAL_ERROR",
	message,
	retryable: true,
	scope,
});

const normalizeError = (error: unknown, fallback: ErrorDetail): ErrorDetail => {
	if (error instanceof ApiError) {
		return error.detail;
	}
	if (error instanceof Error) {
		return {
			...fallback,
			message: error.message,
			detail: error.message,
		};
	}
	return fallback;
};

const isErrorDetail = (payload: unknown): payload is ErrorDetail => {
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const detail = payload as ErrorDetail;
	return (
		typeof detail.code === "string" &&
		typeof detail.message === "string" &&
		typeof detail.retryable === "boolean" &&
		typeof detail.scope === "string"
	);
};

const buildStreamDisconnectedError = (): ErrorDetail => ({
	code: "STREAM_DISCONNECTED",
	message: "SSE 连接异常",
	retryable: true,
	scope: "stream",
});

const buildSessionNotReadyError = (): ErrorDetail => ({
	code: "SESSION_NOT_READY",
	message: "会话未就绪，请重新创建对话",
	retryable: true,
	scope: "session",
});

const getStatusVariant = (state?: string) => {
	switch (state) {
		case "ready":
			return "default";
		case "error":
			return "destructive";
		case "connecting":
			return "secondary";
		case "stopped":
		case "idle":
			return "outline";
		default:
			return "outline";
	}
};

const buildSessionTitle = (sessions: ChatSession[]) =>
	`对话 ${sessions.length + 1}`;

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
		setError,
		setStreamError,
		updateSessionMeta,
		addUserMessage,
		appendAssistantChunk,
		finalizeAssistantMessage,
	} = useChatStore();
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [draftTitle, setDraftTitle] = useState("");
	const [draftBackendId, setDraftBackendId] = useState<string | undefined>();
	const sessionEventSourcesRef = useRef<Map<string, EventSource>>(new Map());

	const sessionsQuery = useQuery({
		queryKey: ["sessions"],
		queryFn: fetchSessions,
		refetchInterval: 5000,
	});

	const backendsQuery = useQuery({
		queryKey: ["acp-backends"],
		queryFn: fetchAcpBackends,
	});

	const availableBackends = backendsQuery.data?.backends ?? [];
	const defaultBackendId =
		backendsQuery.data?.defaultBackendId ?? availableBackends[0]?.backendId;

	useEffect(() => {
		if (sessionsQuery.data?.sessions) {
			syncSessions(sessionsQuery.data.sessions);
		}
	}, [sessionsQuery.data?.sessions, syncSessions]);

	const sessionList = useMemo(() => {
		return Object.values(sessions).sort((left, right) => {
			const leftStamp = left.updatedAt ?? left.createdAt ?? "";
			const rightStamp = right.updatedAt ?? right.createdAt ?? "";
			return rightStamp.localeCompare(leftStamp);
		});
	}, [sessions]);

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

	const createSessionMutation = useMutation({
		mutationFn: createSession,
		onSuccess: (data) => {
			createLocalSession(data.sessionId, {
				title: data.title,
				state: data.state,
				backendId: data.backendId,
				backendLabel: data.backendLabel,
				agentName: data.agentName,
				modelId: data.modelId,
				modelName: data.modelName,
				modeId: data.modeId,
				modeName: data.modeName,
			});
			setActiveSessionId(data.sessionId);
			setAppError(undefined);
			setCreateDialogOpen(false);
			setMobileMenuOpen(false);
		},
		onError: (mutationError: unknown) => {
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("创建会话失败", "service"),
				),
			);
		},
	});

	const renameSessionMutation = useMutation({
		mutationFn: renameSession,
		onError: (mutationError: unknown) => {
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("重命名失败", "session"),
				),
			);
		},
	});

	const closeSessionMutation = useMutation({
		mutationFn: closeSession,
		onSuccess: (_, variables) => {
			removeSession(variables.sessionId);
			setAppError(undefined);
			if (activeSessionId === variables.sessionId) {
				const nextSession = sessionList.find(
					(session) => session.sessionId !== variables.sessionId,
				);
				setActiveSessionId(nextSession?.sessionId);
			}
		},
		onError: (mutationError: unknown) => {
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("关闭会话失败", "session"),
				),
			);
		},
	});

	const sendMessageMutation = useMutation({
		mutationFn: sendMessage,
		onSuccess: (_data, variables) => {
			finalizeAssistantMessage(variables.sessionId);
			setError(variables.sessionId, undefined);
		},
		onError: (mutationError: unknown, variables) => {
			finalizeAssistantMessage(variables.sessionId);
			setError(
				variables.sessionId,
				normalizeError(
					mutationError,
					createFallbackError("发送消息失败", "session"),
				),
			);
		},
		onSettled: (_data, _error, variables) => {
			setSending(variables.sessionId, false);
		},
	});

	useEffect(() => {
		return () => {
			for (const source of sessionEventSourcesRef.current.values()) {
				source.close();
			}
			sessionEventSourcesRef.current.clear();
		};
	}, []);

	useEffect(() => {
		const sources = sessionEventSourcesRef.current;
		const readySessions = Object.values(sessions).filter(
			(session) => session.state === "ready",
		);
		const readyIds = new Set(readySessions.map((session) => session.sessionId));

		for (const session of readySessions) {
			if (sources.has(session.sessionId)) {
				continue;
			}
			setStreamError(session.sessionId, undefined);
			const eventSource = createSessionEventSource(session.sessionId);
			const handleUpdate = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(event.data) as SessionNotification;
					const textChunk = extractTextChunk(payload);
					if (textChunk?.role === "assistant") {
						appendAssistantChunk(session.sessionId, textChunk.text);
					}
					const modeUpdate = extractSessionModeUpdate(payload);
					if (modeUpdate) {
						updateSessionMeta(session.sessionId, {
							modeId: modeUpdate.modeId,
						});
					}
					const infoUpdate = extractSessionInfoUpdate(payload);
					if (infoUpdate) {
						updateSessionMeta(session.sessionId, infoUpdate);
					}
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError("流式消息解析失败", "stream"),
						),
					);
				}
			};

			const handleStreamError = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(event.data) as { error?: unknown };
					if (isErrorDetail(payload.error)) {
						setStreamError(session.sessionId, payload.error);
						return;
					}
				} catch {}
				setStreamError(
					session.sessionId,
					createFallbackError("流式错误解析失败", "stream"),
				);
			};

			eventSource.addEventListener("session_update", handleUpdate);
			eventSource.addEventListener("session_error", handleStreamError);
			eventSource.addEventListener("error", () => {
				setStreamError(session.sessionId, buildStreamDisconnectedError());
			});

			sources.set(session.sessionId, eventSource);
		}

		for (const [sessionId, source] of sources.entries()) {
			if (!readyIds.has(sessionId)) {
				source.close();
				sources.delete(sessionId);
			}
		}
	}, [appendAssistantChunk, sessions, setStreamError, updateSessionMeta]);

	const handleOpenCreateDialog = () => {
		setDraftTitle(buildSessionTitle(sessionList));
		setDraftBackendId(defaultBackendId);
		setCreateDialogOpen(true);
	};

	const handleCreateSession = async () => {
		if (!draftBackendId) {
			setAppError(createFallbackError("请选择后端", "request"));
			return;
		}
		const title = draftTitle.trim();
		setAppError(undefined);
		try {
			await createSessionMutation.mutateAsync({
				backendId: draftBackendId,
				title: title.length > 0 ? title : undefined,
			});
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
		setError(activeSessionId, undefined);
		addUserMessage(activeSessionId, prompt);
		setInput(activeSessionId, "");

		sendMessageMutation.mutate({ sessionId: activeSessionId, prompt });
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

	const agentLabel = activeSession?.agentName;

	const modelLabel = activeSession?.modelName ?? activeSession?.modelId;
	const modeLabel = activeSession?.modeName ?? activeSession?.modeId;

	return (
		<div className="bg-muted/40 text-foreground flex min-h-screen flex-col md:flex-row">
			<AlertDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<AlertDialogContent size="sm">
					<AlertDialogHeader>
						<AlertDialogTitle>新建对话</AlertDialogTitle>
						<AlertDialogDescription>
							选择后端并设置对话标题。
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-2">
							<Label htmlFor="session-title">标题</Label>
							<Input
								id="session-title"
								value={draftTitle}
								onChange={(event) => setDraftTitle(event.target.value)}
								placeholder="可选标题"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="session-backend">后端</Label>
							<Select
								value={draftBackendId}
								onValueChange={setDraftBackendId}
								disabled={availableBackends.length === 0}
							>
								<SelectTrigger id="session-backend">
									<SelectValue
										placeholder={
											availableBackends.length === 0
												? "暂无可用后端"
												: "选择后端"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									{availableBackends.map((backend) => (
										<SelectItem
											key={backend.backendId}
											value={backend.backendId}
										>
											{backend.backendLabel || backend.backendId}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>取消</AlertDialogCancel>
						<AlertDialogAction
							disabled={createSessionMutation.isPending || !draftBackendId}
							onClick={(event) => {
								event.preventDefault();
								void handleCreateSession();
							}}
						>
							{createSessionMutation.isPending ? "创建中..." : "创建"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<aside className="bg-background/80 border-r hidden w-64 flex-col px-4 py-4 md:flex">
				<SessionSidebar
					sessions={sessionList}
					activeSessionId={activeSessionId}
					editingSessionId={editingSessionId}
					editingTitle={editingTitle}
					onCreateSession={handleOpenCreateDialog}
					onSelectSession={(sessionId) => setActiveSessionId(sessionId)}
					onEditSession={handleRenameStart}
					onEditCancel={handleRenameCancel}
					onEditSubmit={handleRenameSubmit}
					onEditingTitleChange={setEditingTitle}
					onCloseSession={(sessionId) =>
						closeSessionMutation.mutate({ sessionId })
					}
					isCreating={createSessionMutation.isPending}
				/>
			</aside>
			{mobileMenuOpen ? (
				<div className="fixed inset-0 z-50 flex md:hidden">
					<div className="bg-background/90 border-r w-72 p-4">
						<SessionSidebar
							sessions={sessionList}
							activeSessionId={activeSessionId}
							editingSessionId={editingSessionId}
							editingTitle={editingTitle}
							onCreateSession={handleOpenCreateDialog}
							onSelectSession={(sessionId) => {
								setActiveSessionId(sessionId);
								setMobileMenuOpen(false);
							}}
							onEditSession={handleRenameStart}
							onEditCancel={handleRenameCancel}
							onEditSubmit={handleRenameSubmit}
							onEditingTitleChange={setEditingTitle}
							onCloseSession={(sessionId) =>
								closeSessionMutation.mutate({ sessionId })
							}
							isCreating={createSessionMutation.isPending}
						/>
					</div>
					<button
						type="button"
						className="bg-black/30 flex-1"
						onClick={() => setMobileMenuOpen(false)}
					/>
				</div>
			) : null}
			<div className="flex min-h-screen flex-1 flex-col">
				<header className="bg-background/80 border-b px-4 py-3 backdrop-blur">
					<div className="mx-auto flex w-full max-w-5xl items-center gap-3">
						<Button
							variant="outline"
							size="icon"
							className="md:hidden"
							onClick={() => setMobileMenuOpen(true)}
						>
							☰
						</Button>
						<div className="flex flex-1 flex-col">
							<span className="text-xs font-semibold tracking-wide">
								Mobvibe
							</span>
							<span className="text-muted-foreground text-xs">
								ACP 多会话 Chat UI
							</span>
						</div>
						<Badge variant={statusVariant}>{statusLabel}</Badge>
						{backendLabel ? (
							<Badge variant="outline">后端: {backendLabel}</Badge>
						) : null}
						{activeSessionId ? (
							<Badge variant="secondary">
								Session {activeSessionId.slice(0, 8)}
							</Badge>
						) : null}
						<Button
							onClick={() => handleOpenCreateDialog()}
							disabled={createSessionMutation.isPending}
						>
							新对话
						</Button>
					</div>
					{statusMessage ? (
						<div className="text-muted-foreground mx-auto mt-2 w-full max-w-5xl text-xs">
							{statusMessage}
						</div>
					) : null}
					{streamError ? (
						<div className="text-destructive mx-auto mt-1 w-full max-w-5xl text-xs">
							{streamError.message}
						</div>
					) : null}
				</header>

				<main className="flex flex-1 flex-col">
					<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
						<div className="flex flex-1 flex-col gap-4 overflow-hidden">
							{!activeSession ? (
								<div className="text-muted-foreground mt-8 text-center text-sm">
									请选择或新建对话开始使用。
								</div>
							) : null}
							{activeSession && activeSession.messages.length === 0 ? (
								<div className="text-muted-foreground mt-8 text-center text-sm">
									开始对话以验证后端连接。
								</div>
							) : null}
							<div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4">
								{activeSession?.messages.map((message: ChatMessage) => (
									<MessageItem key={message.id} message={message} />
								))}
							</div>
						</div>
					</div>
				</main>

				<Separator />
				<footer className="bg-background/90 px-4 py-4">
					<div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
						<Textarea
							value={activeSession?.input ?? ""}
							onChange={(event) =>
								activeSessionId
									? setInput(activeSessionId, event.target.value)
									: undefined
							}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									void handleSend();
								}
							}}
							placeholder="输入消息，Enter 发送，Shift+Enter 换行"
							rows={3}
							disabled={!activeSessionId}
						/>
						{activeSession && (agentLabel || modelLabel || modeLabel) ? (
							<div className="flex flex-wrap items-center gap-2 text-xs">
								{agentLabel ? (
									<Badge variant="outline">Agent: {agentLabel}</Badge>
								) : null}
								{modelLabel ? (
									<Badge variant="outline">Model: {modelLabel}</Badge>
								) : null}
								{modeLabel ? (
									<Badge variant="outline">Mode: {modeLabel}</Badge>
								) : null}
							</div>
						) : null}
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-xs">
								{activeSession?.sending ? "正在发送中..." : ""}
							</span>
							<Button
								onClick={() => void handleSend()}
								disabled={
									!activeSessionId ||
									!activeSession?.input.trim() ||
									activeSession?.sending ||
									activeSession?.state !== "ready"
								}
							>
								发送
							</Button>
						</div>
					</div>
				</footer>
			</div>
		</div>
	);
}

export default App;
