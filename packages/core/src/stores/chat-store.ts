import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
	AvailableCommand,
	ContentBlock,
	ErrorDetail,
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
	SessionModelOption,
	SessionModeOption,
	SessionSummary,
	SessionsChangedPayload,
	ToolCallContent,
	ToolCallLocation,
	ToolCallStatus,
	ToolCallUpdate,
} from "../api/types";
import { i18n } from "../i18n";
import { createDefaultContentBlocks } from "../utils/content-block-utils";
import { getStorageAdapter } from "./storage-adapter";

export type ChatRole = "user" | "assistant";

type TextMessage = {
	id: string;
	role: ChatRole;
	kind: "text";
	content: string;
	contentBlocks: ContentBlock[];
	createdAt: string;
	isStreaming: boolean;
};

export type PermissionDecisionState = "idle" | "submitting";

export type StatusVariant = "info" | "success" | "warning" | "error";

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

export type ToolCallMessage = {
	id: string;
	role: "assistant";
	kind: "tool_call";
	sessionId: string;
	toolCallId: string;
	status?: ToolCallStatus;
	title?: string;
	name?: string;
	command?: string;
	args?: string[];
	duration?: number;
	error?: string;
	content?: ToolCallContent[];
	locations?: ToolCallLocation[];
	rawInput?: Record<string, unknown>;
	rawOutput?: Record<string, unknown>;
	createdAt: string;
	isStreaming: false;
};

export type StatusMessage = {
	id: string;
	role: "assistant";
	kind: "status";
	variant: StatusVariant;
	title: string;
	description?: string;
	createdAt: string;
	isStreaming: false;
};

export type ChatMessage =
	| TextMessage
	| PermissionMessage
	| ToolCallMessage
	| StatusMessage;

export type TerminalOutputSnapshot = {
	terminalId: string;
	output: string;
	truncated: boolean;
	exitStatus?: { exitCode?: number | null; signal?: string | null };
};

export type ChatSession = {
	sessionId: string;
	title: string;
	input: string;
	inputContents: ContentBlock[];
	messages: ChatMessage[];
	terminalOutputs: Record<string, TerminalOutputSnapshot>;
	streamingMessageId?: string;
	streamingMessageRole?: ChatRole;
	sending: boolean;
	canceling: boolean;
	error?: ErrorDetail;
	streamError?: ErrorDetail;
	createdAt?: string;
	updatedAt?: string;
	backendId?: string;
	backendLabel?: string;
	cwd?: string;
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
	availableModes?: SessionModeOption[];
	availableModels?: SessionModelOption[];
	availableCommands?: AvailableCommand[];
	/** Machine ID that owns this session */
	machineId?: string;
	isAttached?: boolean;
	attachedAt?: string;
	detachedAt?: string;
	detachedReason?:
		| "agent_exit"
		| "cli_disconnect"
		| "gateway_disconnect"
		| "unknown";
	isLoading?: boolean;
	/** WAL cursor tracking for sync */
	revision?: number;
	lastAppliedSeq?: number;
	/** Whether backfill is in progress */
	isBackfilling?: boolean;
};

type ChatState = {
	sessions: Record<string, ChatSession>;
	activeSessionId?: string;
	appError?: ErrorDetail;
	lastCreatedCwd?: string;
	syncStatus: "idle" | "syncing" | "error";
	lastSyncAt?: string;
	setActiveSessionId: (value?: string) => void;
	setAppError: (value?: ErrorDetail) => void;
	setLastCreatedCwd: (value?: string) => void;
	setSessionLoading: (sessionId: string, value: boolean) => void;
	markSessionAttached: (payload: {
		sessionId: string;
		machineId?: string;
		attachedAt: string;
	}) => void;
	markSessionDetached: (payload: {
		sessionId: string;
		machineId?: string;
		detachedAt: string;
		reason: ChatSession["detachedReason"];
	}) => void;
	handleSessionsChanged: (payload: SessionsChangedPayload) => void;
	clearSessionMessages: (sessionId: string) => void;
	restoreSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
	createLocalSession: (
		sessionId: string,
		options?: {
			title?: string;
			backendId?: string;
			backendLabel?: string;
			cwd?: string;
			agentName?: string;
			modelId?: string;
			modelName?: string;
			modeId?: string;
			modeName?: string;
			availableModes?: SessionModeOption[];
			availableModels?: SessionModelOption[];
			availableCommands?: AvailableCommand[];
		},
	) => void;
	syncSessions: (summaries: SessionSummary[]) => void;
	removeSession: (sessionId: string) => void;
	renameSession: (sessionId: string, title: string) => void;
	setInput: (sessionId: string, value: string) => void;
	setInputContents: (sessionId: string, contents: ContentBlock[]) => void;
	setSending: (sessionId: string, value: boolean) => void;
	setCanceling: (sessionId: string, value: boolean) => void;
	setError: (sessionId: string, value?: ErrorDetail) => void;
	setStreamError: (sessionId: string, value?: ErrorDetail) => void;
	updateSessionMeta: (
		sessionId: string,
		payload: Partial<
			Pick<
				ChatSession,
				| "title"
				| "updatedAt"
				| "cwd"
				| "agentName"
				| "modelId"
				| "modelName"
				| "modeId"
				| "modeName"
				| "availableModes"
				| "availableModels"
				| "availableCommands"
			>
		>,
	) => void;
	addUserMessage: (
		sessionId: string,
		content: string,
		options?: { messageId?: string; contentBlocks?: ContentBlock[] },
	) => void;
	addStatusMessage: (
		sessionId: string,
		payload: {
			title: string;
			description?: string;
			variant?: StatusVariant;
		},
	) => void;
	appendAssistantChunk: (sessionId: string, content: string) => void;
	appendUserChunk: (sessionId: string, content: string) => void;
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
	addToolCall: (sessionId: string, payload: ToolCallUpdate) => void;
	updateToolCall: (sessionId: string, payload: ToolCallUpdate) => void;
	appendTerminalOutput: (
		sessionId: string,
		payload: {
			terminalId: string;
			delta: string;
			truncated: boolean;
			output?: string;
			exitStatus?: { exitCode?: number | null; signal?: string | null };
		},
	) => void;
	finalizeAssistantMessage: (sessionId: string) => void;
	/** Update session cursor (revision + lastAppliedSeq) */
	updateSessionCursor: (
		sessionId: string,
		revision: number,
		lastAppliedSeq: number,
	) => void;
	/** Set backfilling state for a session */
	setSessionBackfilling: (sessionId: string, isBackfilling: boolean) => void;
	/** Reset session cursor when revision changes (clear messages) */
	resetSessionForRevision: (sessionId: string, newRevision: number) => void;
};

type PersistedChatState = Pick<
	ChatState,
	"sessions" | "activeSessionId" | "lastCreatedCwd"
>;

const createLocalId = () => {
	const cryptoRef = globalThis.crypto;
	if (cryptoRef?.randomUUID) {
		return cryptoRef.randomUUID();
	}
	if (cryptoRef?.getRandomValues) {
		const bytes = new Uint8Array(16);
		cryptoRef.getRandomValues(bytes);
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const toHex = (value: number) => value.toString(16).padStart(2, "0");
		const hex = Array.from(bytes, toHex);
		return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
	}
	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

const createMessage = (role: ChatRole, content: string): TextMessage => ({
	id: createLocalId(),
	role,
	kind: "text",
	content,
	contentBlocks: createDefaultContentBlocks(content),
	createdAt: new Date().toISOString(),
	isStreaming: true,
});

const isTextMessage = (message: ChatMessage): message is TextMessage =>
	message.kind === "text" || message.kind === undefined;

const createPermissionMessage = (payload: {
	requestId: string;
	toolCall?: PermissionToolCall;
	options: PermissionOption[];
}): PermissionMessage => ({
	id: createLocalId(),
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

const resolveToolCallSnapshot = (payload: ToolCallUpdate) => {
	const rawInput =
		payload.rawInput && typeof payload.rawInput === "object"
			? (payload.rawInput as Record<string, unknown>)
			: {};
	const rawOutput =
		payload.rawOutput && typeof payload.rawOutput === "object"
			? (payload.rawOutput as Record<string, unknown>)
			: {};
	const name =
		(typeof rawInput.name === "string" && rawInput.name) ||
		(typeof rawInput.tool === "string" && rawInput.tool) ||
		undefined;
	const command =
		(typeof rawInput.command === "string" && rawInput.command) || undefined;
	const args = Array.isArray(rawInput.args)
		? rawInput.args.filter((arg): arg is string => typeof arg === "string")
		: undefined;
	const duration =
		typeof rawInput.duration === "number"
			? rawInput.duration
			: typeof rawOutput.duration === "number"
				? rawOutput.duration
				: undefined;
	const error =
		(typeof rawInput.error === "string" && rawInput.error) ||
		(typeof rawOutput.error === "string" && rawOutput.error) ||
		(typeof rawOutput.message === "string" && rawOutput.message) ||
		undefined;
	return {
		name,
		command,
		args,
		duration,
		error,
	};
};

const toRecordOrUndefined = (
	value: unknown,
): Record<string, unknown> | undefined => {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return undefined;
};

const createToolCallMessage = (
	sessionId: string,
	payload: ToolCallUpdate,
): ToolCallMessage => {
	const snapshot = resolveToolCallSnapshot(payload);
	return {
		id: createLocalId(),
		role: "assistant",
		kind: "tool_call",
		sessionId,
		toolCallId: payload.toolCallId,
		status: payload.status ?? undefined,
		title: payload.title ?? undefined,
		name: snapshot.name,
		command: snapshot.command,
		args: snapshot.args,
		duration: snapshot.duration,
		error: snapshot.error,
		content: payload.content ?? undefined,
		locations: payload.locations ?? undefined,
		rawInput: toRecordOrUndefined(payload.rawInput),
		rawOutput: toRecordOrUndefined(payload.rawOutput),
		createdAt: new Date().toISOString(),
		isStreaming: false,
	};
};

const mergeToolCallMessage = (
	message: ToolCallMessage,
	payload: ToolCallUpdate,
): ToolCallMessage => {
	const snapshot = resolveToolCallSnapshot(payload);
	return {
		...message,
		status: payload.status ?? message.status,
		title: payload.title ?? message.title,
		name: snapshot.name ?? message.name,
		command: snapshot.command ?? message.command,
		args: snapshot.args ?? message.args,
		duration: snapshot.duration ?? message.duration,
		error: snapshot.error ?? message.error,
		content: payload.content ?? message.content,
		locations: payload.locations ?? message.locations,
		rawInput: toRecordOrUndefined(payload.rawInput) ?? message.rawInput,
		rawOutput: toRecordOrUndefined(payload.rawOutput) ?? message.rawOutput,
	};
};

const createStatusMessage = (payload: {
	title: string;
	description?: string;
	variant?: StatusVariant;
}): StatusMessage => ({
	id: createLocalId(),
	role: "assistant",
	kind: "status",
	variant: payload.variant ?? "info",
	title: payload.title,
	description: payload.description,
	createdAt: new Date().toISOString(),
	isStreaming: false,
});

const createSessionState = (
	sessionId: string,
	options?: {
		title?: string;
		backendId?: string;
		backendLabel?: string;
		cwd?: string;
		agentName?: string;
		modelId?: string;
		modelName?: string;
		modeId?: string;
		modeName?: string;
		availableModes?: SessionModeOption[];
		availableModels?: SessionModelOption[];
		availableCommands?: AvailableCommand[];
		machineId?: string;
	},
): ChatSession => ({
	sessionId,
	title: options?.title ?? i18n.t("session.defaultTitle"),
	input: "",
	inputContents: createDefaultContentBlocks(""),
	messages: [],
	terminalOutputs: {},
	streamingMessageId: undefined,
	streamingMessageRole: undefined,
	sending: false,
	canceling: false,
	error: undefined,
	streamError: undefined,
	createdAt: undefined,
	updatedAt: undefined,
	backendId: options?.backendId,
	backendLabel: options?.backendLabel,
	cwd: options?.cwd,
	agentName: options?.agentName,
	modelId: options?.modelId,
	modelName: options?.modelName,
	modeId: options?.modeId,
	modeName: options?.modeName,
	availableModes: options?.availableModes,
	availableModels: options?.availableModels,
	availableCommands: options?.availableCommands,
	machineId: options?.machineId,
	isAttached: false,
	attachedAt: undefined,
	detachedAt: undefined,
	detachedReason: undefined,
	isLoading: false,
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
	inputContents: createDefaultContentBlocks(""),
	sending: false,
	canceling: false,
	error: undefined,
	streamError: undefined,
	streamingMessageId: undefined,
	streamingMessageRole: undefined,
	isAttached: false,
	isLoading: false,
	isBackfilling: false,
	attachedAt: undefined,
	detachedAt: undefined,
	detachedReason: undefined,
	// Only persist cursors if set, otherwise persist messages (backwards compat)
	// When cursors are set, clear messages as they will be backfilled
	messages: session.revision !== undefined
		? []
		: session.messages.map(sanitizeMessageForPersist),
	// Preserve cursor for backfill on reload
	revision: session.revision,
	lastAppliedSeq: session.lastAppliedSeq,
});

const partializeChatState = (state: ChatState): PersistedChatState => ({
	sessions: Object.keys(state.sessions).reduce<Record<string, ChatSession>>(
		(acc, sessionId) => {
			const session = sanitizeSessionForPersist(state.sessions[sessionId]);
			acc[sessionId] = {
				...session,
				availableCommands: undefined,
			};
			return acc;
		},
		{},
	),
	activeSessionId: state.activeSessionId,
	lastCreatedCwd: state.lastCreatedCwd,
});

export const useChatStore = create<ChatState>()(
	persist(
		(set) => ({
			sessions: {},
			activeSessionId: undefined,
			appError: undefined,
			syncStatus: "idle",
			lastSyncAt: undefined,
			setActiveSessionId: (value?: string) => set({ activeSessionId: value }),
			setAppError: (value?: ErrorDetail) => set({ appError: value }),
			setLastCreatedCwd: (value?: string) => set({ lastCreatedCwd: value }),
			setSessionLoading: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, isLoading: value },
						},
					};
				}),
			markSessionAttached: (payload) =>
				set((state) => {
					const session =
						state.sessions[payload.sessionId] ??
						createSessionState(payload.sessionId);
					return {
						sessions: {
							...state.sessions,
							[payload.sessionId]: {
								...session,
								isAttached: true,
								attachedAt: payload.attachedAt,
								detachedAt: undefined,
								detachedReason: undefined,
								machineId: payload.machineId ?? session.machineId,
							},
						},
					};
				}),
			markSessionDetached: (payload) =>
				set((state) => {
					const session =
						state.sessions[payload.sessionId] ??
						createSessionState(payload.sessionId);
					return {
						sessions: {
							...state.sessions,
							[payload.sessionId]: {
								...session,
								isAttached: false,
								detachedAt: payload.detachedAt,
								detachedReason: payload.reason,
								machineId: payload.machineId ?? session.machineId,
							},
						},
					};
				}),
			handleSessionsChanged: (payload: SessionsChangedPayload) =>
				set((state: ChatState) => {
					const nextSessions: Record<string, ChatSession> = {
						...state.sessions,
					};

					for (const removedId of payload.removed) {
						delete nextSessions[removedId];
					}

					for (const added of payload.added) {
						const existing = nextSessions[added.sessionId];
						if (existing) {
							nextSessions[added.sessionId] = {
								...existing,
								title: added.title ?? existing.title,
								error: added.error,
								createdAt: added.createdAt,
								updatedAt: added.updatedAt,
								backendId: added.backendId ?? existing.backendId,
								backendLabel: added.backendLabel ?? existing.backendLabel,
								cwd: added.cwd ?? existing.cwd,
								agentName: added.agentName ?? existing.agentName,
								modelId: added.modelId ?? existing.modelId,
								modelName: added.modelName ?? existing.modelName,
								modeId: added.modeId ?? existing.modeId,
								modeName: added.modeName ?? existing.modeName,
								availableModes: added.availableModes ?? existing.availableModes,
								availableModels:
									added.availableModels ?? existing.availableModels,
								availableCommands:
									added.availableCommands ?? existing.availableCommands,
								machineId: added.machineId ?? existing.machineId,
							};
						} else {
							nextSessions[added.sessionId] = createSessionState(
								added.sessionId,
								{
									title: added.title,
									backendId: added.backendId,
									backendLabel: added.backendLabel,
									cwd: added.cwd,
									agentName: added.agentName,
									modelId: added.modelId,
									modelName: added.modelName,
									modeId: added.modeId,
									modeName: added.modeName,
									availableModes: added.availableModes,
									availableModels: added.availableModels,
									availableCommands: added.availableCommands,
									machineId: added.machineId,
								},
							);
						}
					}

					for (const updated of payload.updated) {
						const existing = nextSessions[updated.sessionId];
						if (existing) {
							nextSessions[updated.sessionId] = {
								...existing,
								title: updated.title ?? existing.title,
								error: updated.error,
								createdAt: updated.createdAt ?? existing.createdAt,
								updatedAt: updated.updatedAt,
								backendId: updated.backendId ?? existing.backendId,
								backendLabel: updated.backendLabel ?? existing.backendLabel,
								cwd: updated.cwd ?? existing.cwd,
								agentName: updated.agentName ?? existing.agentName,
								modelId: updated.modelId ?? existing.modelId,
								modelName: updated.modelName ?? existing.modelName,
								modeId: updated.modeId ?? existing.modeId,
								modeName: updated.modeName ?? existing.modeName,
								availableModes:
									updated.availableModes ?? existing.availableModes,
								availableModels:
									updated.availableModels ?? existing.availableModels,
								availableCommands:
									updated.availableCommands ?? existing.availableCommands,
								machineId: updated.machineId ?? existing.machineId,
							};
						}
					}

					return {
						sessions: nextSessions,
						lastSyncAt: new Date().toISOString(),
					};
				}),
			clearSessionMessages: (sessionId: string) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [],
								terminalOutputs: {},
								streamingMessageId: undefined,
								streamingMessageRole: undefined,
							},
						},
					};
				}),
			restoreSessionMessages: (sessionId: string, messages: ChatMessage[]) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
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
								backendId: summary.backendId,
								backendLabel: summary.backendLabel,
								cwd: summary.cwd,
								availableModes: summary.availableModes,
								availableModels: summary.availableModels,
								availableCommands: summary.availableCommands,
								machineId: summary.machineId,
							});

						nextSessions[summary.sessionId] = {
							...existing,
							title: summary.title ?? existing.title,
							error: summary.error,
							createdAt: summary.createdAt,
							updatedAt: summary.updatedAt,
							backendId: summary.backendId ?? existing.backendId,
							backendLabel: summary.backendLabel ?? existing.backendLabel,
							cwd: summary.cwd ?? existing.cwd,
							agentName: summary.agentName ?? existing.agentName,
							modelId: summary.modelId ?? existing.modelId,
							modelName: summary.modelName ?? existing.modelName,
							modeId: summary.modeId ?? existing.modeId,
							modeName: summary.modeName ?? existing.modeName,
							availableModes: summary.availableModes ?? existing.availableModes,
							availableModels:
								summary.availableModels ?? existing.availableModels,
							availableCommands:
								summary.availableCommands ?? existing.availableCommands,
							machineId: summary.machineId ?? existing.machineId,
						};
					});

					Object.keys(nextSessions).forEach((sessionId) => {
						if (!serverIds.has(sessionId)) {
							delete nextSessions[sessionId];
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
			setInputContents: (sessionId, contents) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								inputContents: contents,
							},
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
			setCanceling: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, canceling: value },
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
					if (payload.availableModes !== undefined) {
						nextSession.availableModes = payload.availableModes;
					}
					if (payload.availableModels !== undefined) {
						nextSession.availableModels = payload.availableModels;
					}
					if (payload.availableCommands !== undefined) {
						nextSession.availableCommands = payload.availableCommands;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: nextSession,
						},
					};
				}),
			addUserMessage: (sessionId, content, options) =>
				set((state) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					const nextMessage = {
						...createMessage("user", content),
						id: options?.messageId ?? createLocalId(),
						isStreaming: false,
						contentBlocks:
							options?.contentBlocks ?? createDefaultContentBlocks(content),
					};
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [...session.messages, nextMessage],
							},
						},
					};
				}),
			addStatusMessage: (sessionId, payload) =>
				set((state: ChatState) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [...session.messages, createStatusMessage(payload)],
							},
						},
					};
				}),
			appendAssistantChunk: (sessionId, content) =>
				set((state: ChatState) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					let { streamingMessageId, streamingMessageRole } = session;
					let messages = [...session.messages];
					if (!streamingMessageId || streamingMessageRole !== "assistant") {
						const message = createMessage("assistant", "");
						streamingMessageId = message.id;
						streamingMessageRole = "assistant";
						messages = [...messages, message];
					}

					messages = messages.map((message: ChatMessage) => {
						if (message.id !== streamingMessageId || !isTextMessage(message)) {
							return message;
						}
						const nextContent = `${message.content}${content}`;
						const nextBlocks = message.contentBlocks.map((block) =>
							block.type === "text" ? { ...block, text: nextContent } : block,
						);
						return {
							...message,
							content: nextContent,
							contentBlocks: nextBlocks,
						};
					});

					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages,
								streamingMessageId,
								streamingMessageRole,
							},
						},
					};
				}),
			appendUserChunk: (sessionId, content) =>
				set((state: ChatState) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					let { streamingMessageId, streamingMessageRole } = session;
					let messages = [...session.messages];
					if (!streamingMessageId || streamingMessageRole !== "user") {
						const message = createMessage("user", "");
						streamingMessageId = message.id;
						streamingMessageRole = "user";
						messages = [...messages, message];
					}

					messages = messages.map((message: ChatMessage) => {
						if (message.id !== streamingMessageId || !isTextMessage(message)) {
							return message;
						}
						const nextContent = `${message.content}${content}`;
						const nextBlocks = message.contentBlocks.map((block) =>
							block.type === "text" ? { ...block, text: nextContent } : block,
						);
						return {
							...message,
							content: nextContent,
							contentBlocks: nextBlocks,
						};
					});

					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages,
								streamingMessageId,
								streamingMessageRole,
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
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: session.messages.map((message) =>
									message.kind === "permission" &&
									message.requestId === requestId
										? { ...message, decisionState }
										: message,
								),
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
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: session.messages.map((message) =>
									message.kind === "permission" &&
									message.requestId === requestId
										? { ...message, outcome }
										: message,
								),
							},
						},
					};
				}),
			addToolCall: (sessionId, payload) =>
				set((state) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					const existingIndex = session.messages.findIndex(
						(message) =>
							message.kind === "tool_call" &&
							message.toolCallId === payload.toolCallId,
					);
					if (existingIndex >= 0) {
						const messages = session.messages.map((message) =>
							message.kind === "tool_call" &&
							message.toolCallId === payload.toolCallId
								? mergeToolCallMessage(message, payload)
								: message,
						);
						return {
							sessions: {
								...state.sessions,
								[sessionId]: {
									...session,
									messages,
								},
							},
						};
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [
									...session.messages,
									createToolCallMessage(sessionId, payload),
								],
							},
						},
					};
				}),
			updateToolCall: (sessionId, payload) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					let found = false;
					const messages = session.messages.map((message) => {
						if (
							message.kind !== "tool_call" ||
							message.toolCallId !== payload.toolCallId
						) {
							return message;
						}
						found = true;
						return mergeToolCallMessage(message, payload);
					});
					if (!found) {
						messages.push(createToolCallMessage(sessionId, payload));
					}
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
			appendTerminalOutput: (sessionId, payload) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					const existing = session.terminalOutputs[payload.terminalId];
					const nextOutput = payload.truncated
						? (payload.output ?? payload.delta)
						: existing
							? existing.output + payload.delta
							: payload.delta;
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								terminalOutputs: {
									...session.terminalOutputs,
									[payload.terminalId]: {
										terminalId: payload.terminalId,
										output: nextOutput,
										truncated: payload.truncated,
										exitStatus: payload.exitStatus,
									},
								},
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
								streamingMessageRole: undefined,
							},
						},
					};
				}),
			updateSessionCursor: (sessionId, revision, lastAppliedSeq) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								revision,
								lastAppliedSeq,
							},
						},
					};
				}),
			setSessionBackfilling: (sessionId, isBackfilling) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								isBackfilling,
							},
						},
					};
				}),
			resetSessionForRevision: (sessionId, newRevision) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [],
								terminalOutputs: {},
								streamingMessageId: undefined,
								streamingMessageRole: undefined,
								revision: newRevision,
								lastAppliedSeq: 0,
							},
						},
					};
				}),
		}),
		{
			name: STORAGE_KEY,
			partialize: partializeChatState,
			storage: {
				getItem: (name) => {
					const value = getStorageAdapter().getItem(name);
					return value ? JSON.parse(value) : null;
				},
				setItem: (name, value) => {
					getStorageAdapter().setItem(name, JSON.stringify(value));
				},
				removeItem: (name) => {
					getStorageAdapter().removeItem(name);
				},
			},
		},
	),
);

/**
 * Get session cursor for backfill purposes.
 * Use this to determine where to start backfilling events.
 */
export function getSessionCursor(sessionId: string): {
	revision: number;
	lastAppliedSeq: number;
} | null {
	const state = useChatStore.getState();
	const session = state.sessions[sessionId];
	if (!session || session.revision === undefined) return null;
	return {
		revision: session.revision,
		lastAppliedSeq: session.lastAppliedSeq ?? 0,
	};
}
