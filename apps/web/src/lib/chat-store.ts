import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
} from "@/lib/acp";
import type { ErrorDetail, SessionState, SessionSummary } from "@/lib/api";

export type ChatRole = "user" | "assistant";

type TextMessage = {
	id: string;
	role: ChatRole;
	kind?: "text";
	content: string;
	createdAt: string;
	isStreaming: boolean;
};

export type PermissionDecisionState = "idle" | "submitting";

export type PermissionMessage = {
	id: string;
	role: "assistant";
	kind: "permission";
	requestId: string;
	toolCall?: PermissionToolCall;
	options: PermissionOption[];
	outcome?: PermissionOutcome;
	decisionState: PermissionDecisionState;
	createdAt: string;
	isStreaming: false;
};

export type ChatMessage = TextMessage | PermissionMessage;

export type ChatSession = {
	sessionId: string;
	title: string;
	input: string;
	messages: ChatMessage[];
	streamingMessageId?: string;
	sending: boolean;
	error?: ErrorDetail;
	streamError?: ErrorDetail;
	state?: SessionState;
	createdAt?: string;
	updatedAt?: string;
	backendId?: string;
	backendLabel?: string;
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
};

type ChatState = {
	sessions: Record<string, ChatSession>;
	activeSessionId?: string;
	appError?: ErrorDetail;
	setActiveSessionId: (value?: string) => void;
	setAppError: (value?: ErrorDetail) => void;
	createLocalSession: (
		sessionId: string,
		options?: {
			title?: string;
			state?: SessionState;
			backendId?: string;
			backendLabel?: string;
			agentName?: string;
			modelId?: string;
			modelName?: string;
			modeId?: string;
			modeName?: string;
		},
	) => void;
	syncSessions: (summaries: SessionSummary[]) => void;
	removeSession: (sessionId: string) => void;
	renameSession: (sessionId: string, title: string) => void;
	setInput: (sessionId: string, value: string) => void;
	setSending: (sessionId: string, value: boolean) => void;
	setError: (sessionId: string, value?: ErrorDetail) => void;
	setStreamError: (sessionId: string, value?: ErrorDetail) => void;
	updateSessionMeta: (
		sessionId: string,
		payload: Partial<
			Pick<
				ChatSession,
				| "title"
				| "updatedAt"
				| "agentName"
				| "modelId"
				| "modelName"
				| "modeId"
				| "modeName"
			>
		>,
	) => void;
	addUserMessage: (sessionId: string, content: string) => void;
	appendAssistantChunk: (sessionId: string, content: string) => void;
	addPermissionRequest: (
		sessionId: string,
		payload: {
			requestId: string;
			toolCall?: PermissionToolCall;
			options: PermissionOption[];
		},
	) => void;
	setPermissionDecisionState: (
		sessionId: string,
		requestId: string,
		decisionState: PermissionDecisionState,
	) => void;
	setPermissionOutcome: (
		sessionId: string,
		requestId: string,
		outcome: PermissionOutcome,
	) => void;
	finalizeAssistantMessage: (sessionId: string) => void;
};

type PersistedChatState = Pick<ChatState, "sessions" | "activeSessionId">;

const createMessage = (role: ChatRole, content: string): TextMessage => ({
	id: crypto.randomUUID(),
	role,
	kind: "text",
	content,
	createdAt: new Date().toISOString(),
	isStreaming: true,
});

const isTextMessage = (message: ChatMessage): message is TextMessage =>
	message.kind !== "permission";

const isPermissionMessage = (
	message: ChatMessage,
): message is PermissionMessage => message.kind === "permission";

const createPermissionMessage = (payload: {
	requestId: string;
	toolCall?: PermissionToolCall;
	options: PermissionOption[];
}): PermissionMessage => ({
	id: crypto.randomUUID(),
	role: "assistant",
	kind: "permission",
	requestId: payload.requestId,
	toolCall: payload.toolCall,
	options: payload.options,
	outcome: undefined,
	decisionState: "idle" as PermissionDecisionState,
	createdAt: new Date().toISOString(),
	isStreaming: false,
});

const createSessionClosedError = (): ErrorDetail => ({
	code: "SESSION_NOT_FOUND",
	message: "会话已结束或被关闭",
	retryable: false,
	scope: "session",
});

const createSessionState = (
	sessionId: string,
	options?: {
		title?: string;
		state?: SessionState;
		backendId?: string;
		backendLabel?: string;
		agentName?: string;
		modelId?: string;
		modelName?: string;
		modeId?: string;
		modeName?: string;
	},
): ChatSession => ({
	sessionId,
	title: options?.title ?? "新对话",
	input: "",
	messages: [],
	streamingMessageId: undefined,
	sending: false,
	error: undefined,
	streamError: undefined,
	state: options?.state,
	createdAt: undefined,
	updatedAt: undefined,
	backendId: options?.backendId,
	backendLabel: options?.backendLabel,
	agentName: options?.agentName,
	modelId: options?.modelId,
	modelName: options?.modelName,
	modeId: options?.modeId,
	modeName: options?.modeName,
});

const STORAGE_KEY = "mobvibe.chat-store";

const sanitizeMessageForPersist = (message: ChatMessage): ChatMessage => {
	if (message.kind === "permission") {
		return message;
	}
	return {
		...message,
		isStreaming: false,
	};
};

const sanitizeSessionForPersist = (session: ChatSession): ChatSession => ({
	...session,
	input: "",
	sending: false,
	error: undefined,
	streamError: undefined,
	streamingMessageId: undefined,
	messages: session.messages.map(sanitizeMessageForPersist),
});

const partializeChatState = (state: ChatState): PersistedChatState => ({
	sessions: Object.keys(state.sessions).reduce<Record<string, ChatSession>>(
		(acc, sessionId) => {
			acc[sessionId] = sanitizeSessionForPersist(state.sessions[sessionId]);
			return acc;
		},
		{},
	),
	activeSessionId: state.activeSessionId,
});

export const useChatStore = create<ChatState>()(
	persist(
		(set) => ({
			sessions: {},
			activeSessionId: undefined,
			appError: undefined,
			setActiveSessionId: (value?: string) => set({ activeSessionId: value }),
			setAppError: (value?: ErrorDetail) => set({ appError: value }),
			createLocalSession: (sessionId, options) =>
				set((state) => {
					if (state.sessions[sessionId]) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: createSessionState(sessionId, options),
						},
					};
				}),
			syncSessions: (summaries) =>
				set((state: ChatState) => {
					const nextSessions: Record<string, ChatSession> = {
						...state.sessions,
					};
					const serverIds = new Set<string>();
					summaries.forEach((summary) => {
						serverIds.add(summary.sessionId);
						const existing =
							nextSessions[summary.sessionId] ??
							createSessionState(summary.sessionId, {
								title: summary.title,
								state: summary.state,
								backendId: summary.backendId,
								backendLabel: summary.backendLabel,
							});
						nextSessions[summary.sessionId] = {
							...existing,
							title: summary.title ?? existing.title,
							state: summary.state,
							error: summary.error,
							createdAt: summary.createdAt,
							updatedAt: summary.updatedAt,
							backendId: summary.backendId ?? existing.backendId,
							backendLabel: summary.backendLabel ?? existing.backendLabel,
							agentName: summary.agentName ?? existing.agentName,
							modelId: summary.modelId ?? existing.modelId,
							modelName: summary.modelName ?? existing.modelName,
							modeId: summary.modeId ?? existing.modeId,
							modeName: summary.modeName ?? existing.modeName,
						};
					});

					Object.keys(nextSessions).forEach((sessionId) => {
						if (!serverIds.has(sessionId)) {
							const session = nextSessions[sessionId];
							if (session.state !== "stopped") {
								nextSessions[sessionId] = {
									...session,
									state: "stopped",
									error: session.error ?? createSessionClosedError(),
								};
							}
						}
					});

					return { sessions: nextSessions };
				}),
			removeSession: (sessionId: string) =>
				set((state) => {
					const { [sessionId]: _, ...rest } = state.sessions;
					const nextActive =
						state.activeSessionId === sessionId
							? undefined
							: state.activeSessionId;
					return { sessions: rest, activeSessionId: nextActive };
				}),
			renameSession: (sessionId, title) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, title },
						},
					};
				}),
			setInput: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, input: value },
						},
					};
				}),
			setSending: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, sending: value },
						},
					};
				}),
			setError: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, error: value },
						},
					};
				}),
			setStreamError: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, streamError: value },
						},
					};
				}),
			updateSessionMeta: (sessionId, payload) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					const nextSession = { ...session };
					if (payload.title !== undefined) {
						nextSession.title = payload.title;
					}
					if (payload.updatedAt !== undefined) {
						nextSession.updatedAt = payload.updatedAt;
					}
					if (payload.agentName !== undefined) {
						nextSession.agentName = payload.agentName;
					}
					if (payload.modelId !== undefined) {
						nextSession.modelId = payload.modelId;
					}
					if (payload.modelName !== undefined) {
						nextSession.modelName = payload.modelName;
					}
					if (payload.modeId !== undefined) {
						nextSession.modeId = payload.modeId;
					}
					if (payload.modeName !== undefined) {
						nextSession.modeName = payload.modeName;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: nextSession,
						},
					};
				}),
			addUserMessage: (sessionId, content) =>
				set((state: ChatState) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [
									...session.messages,
									{ ...createMessage("user", content), isStreaming: false },
								],
							},
						},
					};
				}),
			appendAssistantChunk: (sessionId, content) =>
				set((state: ChatState) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					let { streamingMessageId } = session;
					let messages = [...session.messages];
					if (!streamingMessageId) {
						const message = createMessage("assistant", "");
						streamingMessageId = message.id;
						messages = [...messages, message];
					}

					messages = messages.map((message: ChatMessage) =>
						message.id === streamingMessageId && isTextMessage(message)
							? {
									...message,
									content: `${message.content}${content}`,
								}
							: message,
					);

					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages,
								streamingMessageId,
							},
						},
					};
				}),
			addPermissionRequest: (sessionId, payload) =>
				set((state) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					const exists = session.messages.some(
						(message) =>
							message.kind === "permission" &&
							message.requestId === payload.requestId,
					);
					if (exists) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [
									...session.messages,
									createPermissionMessage(payload),
								],
							},
						},
					};
				}),
			setPermissionDecisionState: (sessionId, requestId, decisionState) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					const messages = session.messages.map((message) => {
						if (!isPermissionMessage(message)) {
							return message;
						}
						if (message.requestId !== requestId) {
							return message;
						}
						return {
							...message,
							decisionState: decisionState as PermissionDecisionState,
						} as PermissionMessage;
					});
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages,
							},
						},
					};
				}),
			setPermissionOutcome: (sessionId, requestId, outcome) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					const messages = session.messages.map((message) => {
						if (!isPermissionMessage(message)) {
							return message;
						}
						if (message.requestId !== requestId) {
							return message;
						}
						return {
							...message,
							outcome,
							decisionState: "idle" as PermissionDecisionState,
						} as PermissionMessage;
					});
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages,
							},
						},
					};
				}),
			finalizeAssistantMessage: (sessionId) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session?.streamingMessageId) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: session.messages.map((message: ChatMessage) =>
									message.id === session.streamingMessageId &&
									isTextMessage(message)
										? { ...message, isStreaming: false }
										: message,
								),

								streamingMessageId: undefined,
							},
						},
					};
				}),
		}),
		{
			name: STORAGE_KEY,
			partialize: partializeChatState,
		},
	),
);
