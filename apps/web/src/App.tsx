import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { extractTextChunk, type SessionNotification } from "@/lib/acp";
import {
	type CreateSessionResponse,
	createSession,
	createSessionEventSource,
	fetchOpencodeStatus,
	sendMessage,
} from "@/lib/api";
import { type ChatMessage, useChatStore } from "@/lib/chat-store";
import { cn } from "@/lib/utils";

type StreamErrorState = {
	message: string;
};

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

export function App() {
	const {
		sessionId,
		input,
		messages,
		sending,
		error,
		setInput,
		setSessionId,
		setSending,
		setError,
		addUserMessage,
		appendAssistantChunk,
		finalizeAssistantMessage,
	} = useChatStore();
	const [streamError, setStreamError] = useState<StreamErrorState>();

	const statusQuery = useQuery({
		queryKey: ["opencode-status"],
		queryFn: fetchOpencodeStatus,
		refetchInterval: 5000,
	});

	const createSessionMutation = useMutation({
		mutationFn: createSession,
		onSuccess: (data: CreateSessionResponse) => {
			setSessionId(data.sessionId);
			setError(undefined);
		},
		onError: (mutationError: unknown) => {
			setError(buildErrorMessage(mutationError));
		},
	});

	const sendMessageMutation = useMutation({
		mutationFn: sendMessage,
		onSuccess: () => {
			finalizeAssistantMessage();
			setError(undefined);
		},
		onError: (mutationError: unknown) => {
			finalizeAssistantMessage();
			setError(buildErrorMessage(mutationError));
		},
		onSettled: () => {
			setSending(false);
		},
	});

	useEffect(() => {
		if (
			sessionId ||
			createSessionMutation.isPending ||
			statusQuery.data?.state !== "ready"
		) {
			return;
		}
		createSessionMutation.mutate(undefined);
	}, [createSessionMutation, sessionId, statusQuery.data?.state]);

	useEffect(() => {
		if (!sessionId) {
			return;
		}
		setStreamError(undefined);
		const eventSource = createSessionEventSource(sessionId);
		const handleUpdate = (event: MessageEvent<string>) => {
			try {
				const payload = JSON.parse(event.data) as SessionNotification;
				const textChunk = extractTextChunk(payload);
				if (textChunk?.role === "assistant") {
					appendAssistantChunk(textChunk.text);
				}
			} catch (parseError) {
				setStreamError({ message: buildErrorMessage(parseError) });
			}
		};

		eventSource.addEventListener("session_update", handleUpdate);
		eventSource.addEventListener("error", () => {
			setStreamError({ message: "SSE 连接异常" });
		});

		return () => {
			eventSource.removeEventListener("session_update", handleUpdate);
			eventSource.close();
		};
	}, [appendAssistantChunk, sessionId]);

	const handleSend = async () => {
		const prompt = input.trim();
		if (!prompt || sending) {
			return;
		}
		if (statusQuery.data?.state !== "ready") {
			setError("ACP 连接未就绪，请稍后重试");
			return;
		}
		setSending(true);
		setError(undefined);
		addUserMessage(prompt);
		setInput("");

		let activeSessionId = sessionId;
		if (!activeSessionId) {
			try {
				const result = await createSessionMutation.mutateAsync(undefined);
				activeSessionId = result.sessionId;
				setSessionId(result.sessionId);
			} catch (mutationError) {
				setError(buildErrorMessage(mutationError));
				setSending(false);
				return;
			}
		}

		sendMessageMutation.mutate({ sessionId: activeSessionId, prompt });
	};

	const connectionState = statusQuery.data?.state;
	const statusVariant = getStatusVariant(connectionState);
	const statusLabel = connectionState ?? "unknown";

	const statusMessage = useMemo(() => {
		if (statusQuery.isError) {
			return buildErrorMessage(statusQuery.error);
		}
		return statusQuery.data?.lastError ?? error;
	}, [
		error,
		statusQuery.data?.lastError,
		statusQuery.error,
		statusQuery.isError,
	]);

	return (
		<div className="bg-muted/40 text-foreground flex min-h-screen flex-col">
			<header className="bg-background/80 border-b px-4 py-3 backdrop-blur">
				<div className="mx-auto flex w-full max-w-4xl items-center gap-3">
					<div className="flex flex-1 flex-col">
						<span className="text-xs font-semibold tracking-wide">Mobvibe</span>
						<span className="text-muted-foreground text-xs">ACP Chat UI</span>
					</div>
					<Badge variant={statusVariant}>{statusLabel}</Badge>
					{sessionId ? (
						<Badge variant="secondary">Session {sessionId.slice(0, 8)}</Badge>
					) : null}
				</div>
				{statusMessage ? (
					<div className="text-muted-foreground mx-auto mt-2 w-full max-w-4xl text-xs">
						{statusMessage}
					</div>
				) : null}
				{streamError ? (
					<div className="text-destructive mx-auto mt-1 w-full max-w-4xl text-xs">
						{streamError.message}
					</div>
				) : null}
			</header>

			<main className="flex flex-1 flex-col">
				<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
					<div className="flex flex-1 flex-col gap-4 overflow-hidden">
						{messages.length === 0 ? (
							<div className="text-muted-foreground mt-8 text-center text-sm">
								开始对话以验证后端连接。
							</div>
						) : null}
						<div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4">
							{messages.map((message: ChatMessage) => (
								<MessageItem key={message.id} message={message} />
							))}
						</div>
					</div>
				</div>
			</main>

			<Separator />
			<footer className="bg-background/90 px-4 py-4">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
					<Textarea
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void handleSend();
							}
						}}
						placeholder="输入消息，Enter 发送，Shift+Enter 换行"
						rows={3}
					/>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-xs">
							{sending ? "正在发送中..." : ""}
						</span>
						<Button
							onClick={() => void handleSend()}
							disabled={sending || input.trim().length === 0}
						>
							发送
						</Button>
					</div>
				</div>
			</footer>
		</div>
	);
}

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
