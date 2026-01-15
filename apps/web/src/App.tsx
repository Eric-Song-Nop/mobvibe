import { ComputerIcon, SettingsIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
	type PermissionRequestNotification,
	type PermissionResultNotification,
	type SessionNotification,
} from "@/lib/acp";
import {
	ApiError,
	cancelSession,
	closeSession,
	createMessageId,
	createSession,
	createSessionEventSource,
	type ErrorDetail,
	fetchAcpBackends,
	fetchSessions,
	renameSession,
	type SessionSummary,
	sendMessage,
	sendPermissionDecision,
	setSessionMode,
	setSessionModel,
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
	const sessionEventSourcesRef = useRef<Map<string, EventSource>>(new Map());

	const applySessionSummary = (summary: SessionSummary) => {
		updateSessionMeta(summary.sessionId, {
			title: summary.title,
			updatedAt: summary.updatedAt,
			agentName: summary.agentName,
			modelId: summary.modelId,
			modelName: summary.modelName,
			modeId: summary.modeId,
			modeName: summary.modeName,
			availableModes: summary.availableModes,
			availableModels: summary.availableModels,
		});
	};

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
				availableModes: data.availableModes,
				availableModels: data.availableModels,
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

	const cancelSessionMutation = useMutation({
		mutationFn: cancelSession,
		onMutate: (variables) => {
			setCanceling(variables.sessionId, true);
		},
		onSuccess: (_data, variables) => {
			addStatusMessage(variables.sessionId, {
				title: "已取消本次生成",
				variant: "warning",
			});
			finalizeAssistantMessage(variables.sessionId);
			setSending(variables.sessionId, false);
			setCanceling(variables.sessionId, false);
			setAppError(undefined);
		},
		onError: (mutationError: unknown, variables) => {
			setCanceling(variables.sessionId, false);
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("取消会话失败", "session"),
				),
			);
		},
	});

	const setSessionModeMutation = useMutation({
		mutationFn: setSessionMode,
		onSuccess: (summary) => {
			applySessionSummary(summary);
			setAppError(undefined);
		},
		onError: (mutationError: unknown) => {
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("切换模式失败", "session"),
				),
			);
		},
	});

	const setSessionModelMutation = useMutation({
		mutationFn: setSessionModel,
		onSuccess: (summary) => {
			applySessionSummary(summary);
			setAppError(undefined);
		},
		onError: (mutationError: unknown) => {
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("切换模型失败", "session"),
				),
			);
		},
	});

	const sendMessageMutation = useMutation({
		mutationFn: sendMessage,
		onError: (mutationError: unknown) => {
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("发送失败", "session"),
				),
			);
		},
		onSettled: (_data, _error, variables) => {
			if (!variables) {
				return;
			}
			finalizeAssistantMessage(variables.sessionId);
			setSending(variables.sessionId, false);
			setCanceling(variables.sessionId, false);
		},
	});

	const createMessageIdMutation = useMutation({
		mutationFn: createMessageId,
		onError: (mutationError: unknown, variables) => {
			setSending(variables.sessionId, false);
			setCanceling(variables.sessionId, false);
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("获取消息 ID 失败", "session"),
				),
			);
		},
	});

	const permissionDecisionMutation = useMutation({
		mutationFn: sendPermissionDecision,
		onMutate: (variables) => {
			setPermissionDecisionState(
				variables.sessionId,
				variables.requestId,
				"submitting",
			);
		},
		onSuccess: (data) => {
			setPermissionOutcome(data.sessionId, data.requestId, data.outcome);
			setPermissionDecisionState(data.sessionId, data.requestId, "idle");
		},
		onError: (mutationError: unknown, variables) => {
			setPermissionDecisionState(
				variables.sessionId,
				variables.requestId,
				"idle",
			);
			setAppError(
				normalizeError(
					mutationError,
					createFallbackError("权限处理失败", "session"),
				),
			);
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
						const modeName = session.availableModes?.find(
							(mode) => mode.id === modeUpdate.modeId,
						)?.name;
						updateSessionMeta(session.sessionId, {
							modeId: modeUpdate.modeId,
							modeName,
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

			const handlePermissionRequest = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(
						event.data,
					) as PermissionRequestNotification;
					addPermissionRequest(payload.sessionId, {
						requestId: payload.requestId,
						toolCall: payload.toolCall,
						options: payload.options ?? [],
					});
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError("权限请求解析失败", "stream"),
						),
					);
				}
			};

			const handlePermissionResult = (event: MessageEvent<string>) => {
				try {
					const payload = JSON.parse(
						event.data,
					) as PermissionResultNotification;
					setPermissionOutcome(
						payload.sessionId,
						payload.requestId,
						payload.outcome,
					);
					setPermissionDecisionState(
						payload.sessionId,
						payload.requestId,
						"idle",
					);
				} catch (parseError) {
					setStreamError(
						session.sessionId,
						normalizeError(
							parseError,
							createFallbackError("权限结果解析失败", "stream"),
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
			eventSource.addEventListener(
				"permission_request",
				handlePermissionRequest,
			);
			eventSource.addEventListener("permission_result", handlePermissionResult);
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
	}, [
		addPermissionRequest,
		appendAssistantChunk,
		sessions,
		setPermissionDecisionState,
		setPermissionOutcome,
		setStreamError,
		updateSessionMeta,
	]);

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

	const availableModels = activeSession?.availableModels ?? [];
	const availableModes = activeSession?.availableModes ?? [];
	const modelLabel = activeSession?.modelName ?? activeSession?.modelId;
	const modeLabel = activeSession?.modeName ?? activeSession?.modeId;
	const isModeSwitching =
		setSessionModeMutation.isPending &&
		setSessionModeMutation.variables?.sessionId === activeSessionId;
	const isModelSwitching =
		setSessionModelMutation.isPending &&
		setSessionModelMutation.variables?.sessionId === activeSessionId;
	const showFooterMeta = Boolean(
		activeSession && (modelLabel || modeLabel || activeSession.sending),
	);

	return (
		<div className="bg-muted/40 text-foreground flex h-screen flex-col overflow-hidden md:flex-row">
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
			<aside className="bg-background/80 border-r hidden w-64 flex-col px-4 py-4 md:flex min-h-0 overflow-hidden">
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
					<div className="bg-background/90 border-r w-72 p-4 flex h-full flex-col overflow-hidden">
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
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<header className="bg-background/80 border-b px-4 py-3 backdrop-blur">
					<div className="mx-auto flex w-full max-w-5xl items-center gap-2">
						<Button
							variant="outline"
							size="icon"
							className="md:hidden"
							onClick={() => setMobileMenuOpen(true)}
						>
							☰
						</Button>
						<div className="flex flex-1 flex-wrap items-center gap-2">
							<Badge variant={statusVariant} className="shrink-0">
								{statusLabel}
							</Badge>
							{backendLabel ? (
								<Badge variant="outline" className="shrink-0">
									后端: {backendLabel}
								</Badge>
							) : null}
						</div>
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

				<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="mx-auto flex w-full max-w-5xl flex-1 min-h-0 flex-col gap-4 px-4 py-6">
						<div className="flex min-h-0 flex-1 flex-col gap-4">
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
							<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4">
								{activeSession?.messages.map((message: ChatMessage) => (
									<MessageItem
										key={message.id}
										message={message}
										onPermissionDecision={handlePermissionDecision}
									/>
								))}
							</div>
						</div>
					</div>
				</main>

				<Separator />
				<footer className="bg-background/90 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shrink-0">
					<div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
						<div className="flex items-end gap-2">
							<Textarea
								className="flex-1"
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
								rows={2}
								disabled={!activeSessionId}
							/>
							<div className="flex items-center gap-2">
								{activeSession?.sending ? (
									<Button
										size="sm"
										variant="outline"
										onClick={() => handleCancel()}
										disabled={
											!activeSessionId ||
											activeSession?.canceling ||
											activeSession?.state !== "ready"
										}
									>
										{activeSession?.canceling ? "停止中..." : "停止"}
									</Button>
								) : null}
								<Button
									size="sm"
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
						{showFooterMeta ? (
							<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
								<div className="flex flex-wrap items-center gap-2">
									{availableModels.length > 0 ? (
										<Select
											value={activeSession?.modelId ?? ""}
											onValueChange={handleModelChange}
											disabled={
												!activeSessionId ||
												activeSession?.state !== "ready" ||
												isModelSwitching
											}
										>
											<SelectTrigger
												size="sm"
												className="h-7 w-11 px-1 md:w-auto md:px-2"
											>
												<HugeiconsIcon
													icon={ComputerIcon}
													strokeWidth={2}
													className="size-4"
												/>
												<SelectValue
													placeholder="Model"
													className="sr-only md:not-sr-only"
												/>
											</SelectTrigger>
											<SelectContent>
												{availableModels.map((model) => (
													<SelectItem key={model.id} value={model.id}>
														Model: {model.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : modelLabel ? (
										<Badge
											variant="outline"
											className="flex items-center gap-1"
										>
											<HugeiconsIcon
												icon={ComputerIcon}
												strokeWidth={2}
												className="size-4"
											/>
											<span className="sr-only md:not-sr-only">
												Model: {modelLabel}
											</span>
										</Badge>
									) : null}
									{availableModes.length > 0 ? (
										<Select
											value={activeSession?.modeId ?? ""}
											onValueChange={handleModeChange}
											disabled={
												!activeSessionId ||
												activeSession?.state !== "ready" ||
												isModeSwitching
											}
										>
											<SelectTrigger
												size="sm"
												className="h-7 w-11 px-1 md:w-auto md:px-2"
											>
												<HugeiconsIcon
													icon={SettingsIcon}
													strokeWidth={2}
													className="size-4"
												/>
												<SelectValue
													placeholder="Mode"
													className="sr-only md:not-sr-only"
												/>
											</SelectTrigger>
											<SelectContent>
												{availableModes.map((mode) => (
													<SelectItem key={mode.id} value={mode.id}>
														Mode: {mode.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : modeLabel ? (
										<Badge
											variant="outline"
											className="flex items-center gap-1"
										>
											<HugeiconsIcon
												icon={SettingsIcon}
												strokeWidth={2}
												className="size-4"
											/>
											<span className="sr-only md:not-sr-only">
												Mode: {modeLabel}
											</span>
										</Badge>
									) : null}
								</div>
								{activeSession?.sending ? (
									<span className="text-muted-foreground text-xs">
										正在发送中...
									</span>
								) : null}
							</div>
						) : null}
					</div>
				</footer>
			</div>
		</div>
	);
}

export default App;
