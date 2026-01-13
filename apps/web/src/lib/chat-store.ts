import { create } from "zustand";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	createdAt: string;
	isStreaming: boolean;
};

type ChatState = {
	sessionId?: string;
	input: string;
	messages: ChatMessage[];
	streamingMessageId?: string;
	sending: boolean;
	error?: string;
	setInput: (value: string) => void;
	setSessionId: (value?: string) => void;
	setSending: (value: boolean) => void;
	setError: (value?: string) => void;
	addUserMessage: (content: string) => void;
	appendAssistantChunk: (content: string) => void;
	finalizeAssistantMessage: () => void;
	reset: () => void;
};

type ChatStateUpdater = (state: ChatState) => ChatState | Partial<ChatState>;

type ChatStateSetter = (
	partial: ChatState | Partial<ChatState> | ChatStateUpdater,
	replace?: boolean,
) => void;

const createMessage = (role: ChatRole, content: string): ChatMessage => ({
	id: crypto.randomUUID(),
	role,
	content,
	createdAt: new Date().toISOString(),
	isStreaming: true,
});

export const useChatStore = create<ChatState>((set: ChatStateSetter) => ({
	sessionId: undefined,
	input: "",
	messages: [],
	streamingMessageId: undefined,
	sending: false,
	error: undefined,
	setInput: (value: string) => set({ input: value }),
	setSessionId: (value?: string) => set({ sessionId: value }),
	setSending: (value: boolean) => set({ sending: value }),
	setError: (value?: string) => set({ error: value }),
	addUserMessage: (content: string) =>
		set((state: ChatState) => ({
			messages: [
				...state.messages,
				{
					...createMessage("user", content),
					isStreaming: false,
				},
			],
		})),
	appendAssistantChunk: (content: string) =>
		set((state: ChatState) => {
			let { streamingMessageId } = state;
			let messages = [...state.messages];
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

			return { messages, streamingMessageId };
		}),
	finalizeAssistantMessage: () =>
		set((state: ChatState) => {
			if (!state.streamingMessageId) {
				return state;
			}
			return {
				messages: state.messages.map((message: ChatMessage) =>
					message.id === state.streamingMessageId
						? { ...message, isStreaming: false }
						: message,
				),
				streamingMessageId: undefined,
			};
		}),
	reset: () =>
		set({
			sessionId: undefined,
			input: "",
			messages: [],
			streamingMessageId: undefined,
			sending: false,
			error: undefined,
		}),
}));
