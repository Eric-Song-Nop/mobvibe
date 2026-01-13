import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
	extractSessionInfoUpdate,
	extractSessionModeUpdate,
	extractTextChunk,
	type SessionNotification,
} from "@/lib/acp";
import {
	closeSession,
	createSession,
	createSessionEventSource,
	fetchSessions,
	renameSession,
	sendMessage,
} from "@/lib/api";
import {
	type ChatMessage,
	type ChatSession,
	useChatStore,
} from "@/lib/chat-store";
import { cn } from "@/lib/utils";

const buildErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

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

	const sessionsQuery = useQuery({
		queryKey: ["sessions"],
		queryFn: fetchSessions,
		refetchInterval: 5000,
	});

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

	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;

	const activeSessionState = activeSession?.state;

	const createSessionMutation = useMutation({
		mutationFn: createSession,
		onSuccess: (data) => {
			createLocalSession(data.sessionId, {
				title: data.title,
				state: data.state,
				agentName: data.agentName,
				modelId: data.modelId,
				modelName: data.modelName,
				modeId: data.modeId,
				modeName: data.modeName,
			});
			setActiveSessionId(data.sessionId);
			setAppError(undefined);
			setMobileMenuOpen(false);
		},
		onError: (mutationError: unknown) => {
			setAppError(buildErrorMessage(mutationError));
		},
	});

	const renameSessionMutation = useMutation({
		mutationFn: renameSession,
		onError: (mutationError: unknown) => {
			setAppError(buildErrorMessage(mutationError));
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
			setAppError(buildErrorMessage(mutationError));
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
			setError(variables.sessionId, buildErrorMessage(mutationError));
		},
		onSettled: (_data, _error, variables) => {
			setSending(variables.sessionId, false);
		},
	});

	useEffect(() => {
		if (!activeSessionId || activeSessionState !== "ready") {
			return;
		}
		setStreamError(activeSessionId, undefined);
		const eventSource = createSessionEventSource(activeSessionId);
		const handleUpdate = (event: MessageEvent<string>) => {
			try {
				const payload = JSON.parse(event.data) as SessionNotification;
				const textChunk = extractTextChunk(payload);
				if (textChunk?.role === "assistant") {
					appendAssistantChunk(activeSessionId, textChunk.text);
				}
				const modeUpdate = extractSessionModeUpdate(payload);
				if (modeUpdate) {
					updateSessionMeta(activeSessionId, { modeId: modeUpdate.modeId });
				}
				const infoUpdate = extractSessionInfoUpdate(payload);
				if (infoUpdate) {
					updateSessionMeta(activeSessionId, infoUpdate);
				}
			} catch (parseError) {
				setStreamError(activeSessionId, buildErrorMessage(parseError));
			}
		};

		eventSource.addEventListener("session_update", handleUpdate);
		eventSource.addEventListener("error", () => {
			setStreamError(activeSessionId, "SSE 连接异常");
		});

		return () => {
			eventSource.removeEventListener("session_update", handleUpdate);
			eventSource.close();
		};
	}, [
		activeSessionId,
		activeSessionState,
		appendAssistantChunk,
		setStreamError,
		updateSessionMeta,
	]);

	const handleCreateSession = async () => {
		const title = buildSessionTitle(sessionList);
		setAppError(undefined);
		try {
			await createSessionMutation.mutateAsync({ title });
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
			setError(activeSessionId, "会话未就绪，请重新创建对话");
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
		if (sessionsQuery.isError) {
			return buildErrorMessage(sessionsQuery.error);
		}
		return appError ?? activeSession?.error ?? activeSession?.lastError;
	}, [
		activeSession?.error,
		activeSession?.lastError,
		appError,
		sessionsQuery.error,
		sessionsQuery.isError,
	]);

	const streamError = activeSession?.streamError
		? { message: activeSession.streamError }
		: undefined;

	const agentLabel = activeSession?.agentName;
	const modelLabel = activeSession?.modelName ?? activeSession?.modelId;
	const modeLabel = activeSession?.modeName ?? activeSession?.modeId;

	return (
		<div className="bg-muted/40 text-foreground flex min-h-screen flex-col md:flex-row">
			<aside className="bg-background/80 border-r hidden w-64 flex-col px-4 py-4 md:flex">
				<SessionSidebar
					sessions={sessionList}
					activeSessionId={activeSessionId}
					editingSessionId={editingSessionId}
					editingTitle={editingTitle}
					onCreateSession={handleCreateSession}
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
							onCreateSession={handleCreateSession}
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
						{activeSessionId ? (
							<Badge variant="secondary">
								Session {activeSessionId.slice(0, 8)}
							</Badge>
						) : null}
						<Button
							onClick={() => void handleCreateSession()}
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

type SessionSidebarProps = {
	sessions: ChatSession[];
	activeSessionId?: string;
	editingSessionId: string | null;
	editingTitle: string;
	onCreateSession: () => void;
	onSelectSession: (sessionId: string) => void;
	onEditSession: (session: ChatSession) => void;
	onEditCancel: () => void;
	onEditSubmit: () => void;
	onEditingTitleChange: (value: string) => void;
	onCloseSession: (sessionId: string) => void;
	isCreating: boolean;
};

const SessionSidebar = ({
	sessions,
	activeSessionId,
	editingSessionId,
	editingTitle,
	onCreateSession,
	onSelectSession,
	onEditSession,
	onEditCancel,
	onEditSubmit,
	onEditingTitleChange,
	onCloseSession,
	isCreating,
}: SessionSidebarProps) => {
	return (
		<div className="flex h-full flex-col gap-4">
			<div className="flex items-center justify-between">
				<div className="text-sm font-semibold">对话</div>
				<Button onClick={onCreateSession} size="sm" disabled={isCreating}>
					新建
				</Button>
			</div>
			<div className="flex flex-1 flex-col gap-2 overflow-y-auto">
				{sessions.length === 0 ? (
					<div className="text-muted-foreground text-xs">暂无对话</div>
				) : null}
				{sessions.map((session) => (
					<SessionListItem
						key={session.sessionId}
						session={session}
						isActive={session.sessionId === activeSessionId}
						isEditing={session.sessionId === editingSessionId}
						editingTitle={editingTitle}
						onSelect={onSelectSession}
						onEdit={onEditSession}
						onEditCancel={onEditCancel}
						onEditSubmit={onEditSubmit}
						onEditingTitleChange={onEditingTitleChange}
						onClose={onCloseSession}
					/>
				))}
			</div>
		</div>
	);
};

type SessionListItemProps = {
	session: ChatSession;
	isActive: boolean;
	isEditing: boolean;
	editingTitle: string;
	onSelect: (sessionId: string) => void;
	onEdit: (session: ChatSession) => void;
	onEditCancel: () => void;
	onEditSubmit: () => void;
	onEditingTitleChange: (value: string) => void;
	onClose: (sessionId: string) => void;
};

const SessionListItem = ({
	session,
	isActive,
	isEditing,
	editingTitle,
	onSelect,
	onEdit,
	onEditCancel,
	onEditSubmit,
	onEditingTitleChange,
	onClose,
}: SessionListItemProps) => {
	const statusVariant = getStatusVariant(session.state);
	return (
		<div
			className={cn(
				"border-border bg-background hover:bg-muted flex flex-col gap-2 rounded-none border p-2 text-left",
				isActive ? "border-primary/40" : "",
			)}
		>
			<div
				role="button"
				tabIndex={0}
				onClick={() => onSelect(session.sessionId)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						onSelect(session.sessionId);
					}
				}}
				className="flex flex-1 flex-col gap-1"
			>
				<div className="flex items-center justify-between gap-2">
					{isEditing ? (
						<Input
							value={editingTitle}
							onChange={(event) => onEditingTitleChange(event.target.value)}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => event.stopPropagation()}
							className="h-7 text-xs"
						/>
					) : (
						<span className="text-sm font-medium">{session.title}</span>
					)}
					<Badge variant={statusVariant}>{session.state ?? "idle"}</Badge>
				</div>
				{session.lastError ? (
					<span className="text-destructive text-xs">{session.lastError}</span>
				) : null}
			</div>
			<div className="flex items-center gap-2">
				{isEditing ? (
					<>
						<Button size="xs" onClick={onEditSubmit}>
							保存
						</Button>
						<Button size="xs" variant="outline" onClick={onEditCancel}>
							取消
						</Button>
					</>
				) : (
					<Button size="xs" variant="ghost" onClick={() => onEdit(session)}>
						改名
					</Button>
				)}
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button size="xs" variant="destructive">
							关闭
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent size="sm">
						<AlertDialogHeader>
							<AlertDialogTitle>关闭对话？</AlertDialogTitle>
							<AlertDialogDescription>
								关闭后将断开后端会话进程，前端仍保留消息记录。
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>取消</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => onClose(session.sessionId)}
							>
								确认关闭
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
};

type MessageItemProps = {
	message: ChatMessage;
};

const MessageItem = ({ message }: MessageItemProps) => {
	const isUser = message.role === "user";
	return (
		<div
			className={cn(
				"flex flex-col gap-1",
				isUser ? "items-end" : "items-start",
			)}
		>
			<Card
				size="sm"
				className={cn(
					"max-w-[85%]",
					isUser
						? "border-primary/30 bg-primary/10"
						: "border-border bg-background",
					message.isStreaming ? "opacity-90" : "opacity-100",
				)}
			>
				<CardContent className="text-sm">
					<Streamdown>{message.content}</Streamdown>
				</CardContent>
			</Card>
		</div>
	);
};

export default App;
