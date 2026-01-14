import { create } from "zustand";
import type { ErrorDetail, SessionState, SessionSummary } from "@/lib/api";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	createdAt: string;
	isStreaming: boolean;
};

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
	finalizeAssistantMessage: (sessionId: string) => void;
};

const createMessage = (role: ChatRole, content: string): ChatMessage => ({
	id: crypto.randomUUID(),
	role,
	content,
	createdAt: new Date().toISOString(),
	isStreaming: true,
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
	agentName: options?.agentName,
	modelId: options?.modelId,
	modelName: options?.modelName,
	modeId: options?.modeId,
	modeName: options?.modeName,
});

export const useChatStore = create<ChatState>((set) => ({
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
					});
				nextSessions[summary.sessionId] = {
					...existing,
					title: summary.title ?? existing.title,
					state: summary.state,
					error: summary.error,
					createdAt: summary.createdAt,
					updatedAt: summary.updatedAt,
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
				state.activeSessionId === sessionId ? undefined : state.activeSessionId;
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
				message.id === streamingMessageId
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
							message.id === session.streamingMessageId
								? { ...message, isStreaming: false }
								: message,
						),
						streamingMessageId: undefined,
					},
				},
			};
		}),
}));
