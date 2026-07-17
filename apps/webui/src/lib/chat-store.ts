import type {
	AvailableCommand,
	ContentBlock,
	ErrorDetail,
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
	PlanEntry,
	SessionConfigOption,
	SessionEvent,
	SessionModelOption,
	SessionModeOption,
	SessionSummary,
	SessionsChangedPayload,
	ToolCallContent,
	ToolCallLocation,
	ToolCallStatus,
	ToolCallUpdate,
} from "@mobvibe/shared";
import { create, type StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/i18n";
import {
	appendContentBlock,
	createDefaultContentBlocks,
	hasSameTextBlockMetadata,
	normalizeContentBlock,
} from "./content-block-utils";
import type { E2EEStatus } from "./e2ee";
import { getStorageAdapter } from "./storage-adapter";

export type ChatRole = "user" | "assistant";

type TextMessage = {
	id: string;
	/** ACP message boundary identifier; unrelated to the local message id. */
	protocolMessageId?: string;
	role: ChatRole;
	kind: "text";
	content: string;
	contentBlocks: ContentBlock[];
	createdAt: string;
	isStreaming: boolean;
	/** Optimistically added user message, awaiting server confirmation */
	provisional?: boolean;
	/** Message failed to send and needs user attention */
	failed?: boolean;
	/** True when content is being reconstructed from persisted user chunks. */
	serverChunked?: boolean;
	/** Last persisted user chunk folded into this message. */
	lastServerChunkSeq?: number;
	/** Server-only message reconstructed from legacy chunks without messageId. */
	legacyServerChunked?: boolean;
	/** Legacy echo accumulated while confirming an optimistic multi-block prompt. */
	legacyServerEchoBlocks?: ContentBlock[];
};

type ThoughtMessage = {
	id: string;
	/** ACP message boundary identifier; unrelated to the local message id. */
	protocolMessageId?: string;
	role: "assistant";
	kind: "thought";
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
	| ThoughtMessage
	| PermissionMessage
	| ToolCallMessage
	| StatusMessage;

export type TerminalOutputSnapshot = {
	terminalId: string;
	output: string;
	truncated: boolean;
	exitStatus?: { exitCode?: number | null; signal?: string | null };
};

export type SessionRestoreSnapshot = {
	lastAppliedSeq?: number;
	revision?: number;
	terminalOutputs?: Record<string, TerminalOutputSnapshot>;
	streamingMessageId?: string;
	streamingMessageRole?: ChatRole;
	streamingThoughtId?: string;
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
	streamingThoughtId?: string;
	sending: boolean;
	canceling: boolean;
	error?: ErrorDetail;
	streamError?: ErrorDetail;
	createdAt?: string;
	updatedAt?: string;
	backendId?: string;
	backendLabel?: string;
	cwd?: string;
	additionalDirectories?: string[];
	agentName?: string;
	modelId?: string;
	modelName?: string;
	modeId?: string;
	modeName?: string;
	availableModes?: SessionModeOption[];
	availableModels?: SessionModelOption[];
	configOptions?: SessionConfigOption[];
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
		| "session_close"
		| "unknown";
	isLoading?: boolean;
	historySyncing?: boolean;
	historySyncWarning?: ErrorDetail;
	/** Indicates this session is being created optimistically (before server confirmation) */
	isCreating?: boolean;
	/** Usage tracking from ACP agent */
	usage?: {
		used: number;
		size: number;
		cost?: { amount: number; currency: string };
	};
	/** Agent-defined metadata from session_info_update RFD */
	_meta?: Record<string, unknown> | null;
	/** WAL cursor tracking for sync */
	revision?: number;
	lastAppliedSeq?: number;
	/** Runtime-only E2EE status (not persisted) */
	e2eeStatus?: E2EEStatus;
	/** Original repo cwd (only for worktree sessions) */
	worktreeSourceCwd?: string;
	/** Branch name of the worktree (only for worktree sessions) */
	worktreeBranch?: string;
	/** Stable workspace/project root for grouping and navigation */
	workspaceRootCwd?: string;
	/** Agent execution plan entries (replaced in full on each update) */
	plan?: PlanEntry[];
	/** Whether the title was manually set by the user (immune to agent auto-update) */
	isTitlePinned?: boolean;
};

export type SessionListEntry = Pick<
	ChatSession,
	| "sessionId"
	| "title"
	| "createdAt"
	| "updatedAt"
	| "backendId"
	| "backendLabel"
	| "error"
	| "detachedReason"
	| "isLoading"
	| "isAttached"
	| "isCreating"
	| "worktreeBranch"
	| "e2eeStatus"
	| "machineId"
	| "cwd"
	| "worktreeSourceCwd"
>;

export const toSessionListEntry = (session: ChatSession): SessionListEntry => ({
	sessionId: session.sessionId,
	title: session.title,
	createdAt: session.createdAt,
	updatedAt: session.updatedAt,
	backendId: session.backendId,
	backendLabel: session.backendLabel,
	error: session.error,
	detachedReason: session.detachedReason,
	isLoading: session.isLoading,
	isAttached: session.isAttached,
	isCreating: session.isCreating,
	worktreeBranch: session.worktreeBranch,
	e2eeStatus: session.e2eeStatus,
	machineId: session.machineId,
	cwd: session.cwd,
	worktreeSourceCwd: session.worktreeSourceCwd,
});

type ChatState = {
	sessions: Record<string, ChatSession>;
	activeSessionId?: string;
	appError?: ErrorDetail;
	lastCreatedCwd: Record<string, string>;
	syncStatus: "idle" | "syncing" | "error";
	lastSyncAt?: string;
	setActiveSessionId: (value?: string) => void;
	setAppError: (value?: ErrorDetail) => void;
	setLastCreatedCwd: (machineId: string, cwd: string) => void;
	setSessionLoading: (sessionId: string, value: boolean) => void;
	setHistorySyncing: (sessionId: string, value: boolean) => void;
	setHistorySyncWarning: (
		sessionId: string,
		value?: ChatSession["historySyncWarning"],
	) => void;
	markSessionAttached: (payload: {
		sessionId: string;
		machineId?: string;
		attachedAt: string;
		revision?: number;
	}) => void;
	markSessionDetached: (payload: {
		sessionId: string;
		machineId?: string;
		detachedAt: string;
		reason: ChatSession["detachedReason"];
	}) => void;
	handleSessionsChanged: (payload: SessionsChangedPayload) => void;
	clearSessionMessages: (sessionId: string) => void;
	restoreSessionMessages: (
		sessionId: string,
		messages: ChatMessage[],
		snapshot?: SessionRestoreSnapshot,
	) => void;
	createLocalSession: (
		sessionId: string,
		options?: {
			title?: string;
			backendId?: string;
			backendLabel?: string;
			cwd?: string;
			additionalDirectories?: string[];
			agentName?: string;
			modelId?: string;
			modelName?: string;
			modeId?: string;
			modeName?: string;
			availableModes?: SessionModeOption[];
			availableModels?: SessionModelOption[];
			configOptions?: SessionConfigOption[];
			availableCommands?: AvailableCommand[];
			createdAt?: string;
			updatedAt?: string;
			machineId?: string;
			isCreating?: boolean;
			worktreeSourceCwd?: string;
			worktreeBranch?: string;
			workspaceRootCwd?: string;
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
				| "additionalDirectories"
				| "workspaceRootCwd"
				| "agentName"
				| "modelId"
				| "modelName"
				| "modeId"
				| "modeName"
				| "availableModes"
				| "availableModels"
				| "configOptions"
				| "availableCommands"
				| "worktreeSourceCwd"
				| "worktreeBranch"
				| "usage"
				| "_meta"
				| "plan"
				| "isTitlePinned"
			>
		>,
	) => void;
	addUserMessage: (
		sessionId: string,
		content: string,
		options?: {
			messageId?: string;
			contentBlocks?: ContentBlock[];
			provisional?: boolean;
		},
	) => void;
	/** Confirm a provisional user message or append a new one (backfill) */
	confirmOrAppendUserMessage: (
		sessionId: string,
		chunk: ContentBlock | string,
		sendMessageId?: string,
		eventSeq?: number,
		protocolMessageId?: string,
	) => void;
	markUserMessageFailed: (sessionId: string, messageId: string) => void;
	addStatusMessage: (
		sessionId: string,
		payload: {
			title: string;
			description?: string;
			variant?: StatusVariant;
		},
	) => void;
	appendAssistantChunk: (
		sessionId: string,
		content: ContentBlock | string,
		protocolMessageId?: string,
	) => void;
	appendThoughtChunk: (
		sessionId: string,
		content: ContentBlock | string,
		protocolMessageId?: string,
	) => void;
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
	/** Reduce one WAL event and advance its cursor in one state/persist commit. */
	applySessionEventTransaction: (
		event: Pick<SessionEvent, "sessionId" | "revision" | "seq">,
		applyEvent: (actions: SessionEventTransactionActions) => void,
	) => void;
	/** Update session cursor (revision + lastAppliedSeq) */
	updateSessionCursor: (
		sessionId: string,
		revision: number,
		lastAppliedSeq: number,
	) => void;
	/** Reset session cursor when revision changes (clear messages) */
	resetSessionForRevision: (sessionId: string, newRevision: number) => void;
	/** Set E2EE status for a session (runtime-only, not persisted) */
	setSessionE2EEStatus: (
		sessionId: string,
		status: ChatSession["e2eeStatus"],
	) => void;
};

export type SessionEventTransactionActions = Pick<
	ChatState,
	| "appendAssistantChunk"
	| "appendThoughtChunk"
	| "confirmOrAppendUserMessage"
	| "updateSessionMeta"
	| "setStreamError"
	| "addPermissionRequest"
	| "setPermissionDecisionState"
	| "setPermissionOutcome"
	| "addToolCall"
	| "updateToolCall"
	| "appendTerminalOutput"
	| "finalizeAssistantMessage"
	| "setSending"
	| "setCanceling"
>;

export const selectTerminalOutputSnapshot = (
	state: Pick<ChatState, "sessions">,
	sessionId: string | undefined,
	terminalId: string,
): TerminalOutputSnapshot | undefined => {
	if (!sessionId) {
		return undefined;
	}
	return state.sessions[sessionId]?.terminalOutputs[terminalId];
};

type PersistedChatState = Pick<
	ChatState,
	"sessions" | "activeSessionId" | "lastCreatedCwd"
>;

import { createLocalId } from "./id-utils";

const createMessage = (role: ChatRole, content: string): TextMessage => ({
	id: createLocalId(),
	role,
	kind: "text",
	content,
	contentBlocks: createDefaultContentBlocks(content),
	createdAt: new Date().toISOString(),
	isStreaming: true,
});

const isSameContentBlock = (left: ContentBlock, right: ContentBlock): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const coalesceTextBlocks = (blocks: ContentBlock[]): ContentBlock[] => {
	let result: ContentBlock[] = [];
	for (const block of blocks) {
		result = appendContentBlock(result, block);
	}
	return result;
};

const contentBlockMatches = (
	left: ContentBlock,
	right: ContentBlock,
): boolean => isSameContentBlock(left, right);

const isContentBlockSequencePrefix = (
	candidateBlocks: ContentBlock[],
	expectedBlocks: ContentBlock[],
): boolean => {
	const candidate = coalesceTextBlocks(candidateBlocks);
	const expected = coalesceTextBlocks(expectedBlocks);
	if (candidate.length > expected.length) return false;
	return candidate.every((block, index) => {
		const expectedBlock = expected[index];
		if (!expectedBlock) return false;
		if (
			index === candidate.length - 1 &&
			block.type === "text" &&
			expectedBlock.type === "text"
		) {
			return (
				hasSameTextBlockMetadata(block, expectedBlock) &&
				expectedBlock.text.startsWith(block.text)
			);
		}
		return contentBlockMatches(block, expectedBlock);
	});
};

const areContentBlockSequencesEqual = (
	leftBlocks: ContentBlock[],
	rightBlocks: ContentBlock[],
): boolean => {
	const left = coalesceTextBlocks(leftBlocks);
	const right = coalesceTextBlocks(rightBlocks);
	return (
		left.length === right.length &&
		left.every((block, index) => contentBlockMatches(block, right[index]))
	);
};

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
		additionalDirectories?: string[];
		agentName?: string;
		modelId?: string;
		modelName?: string;
		modeId?: string;
		modeName?: string;
		availableModes?: SessionModeOption[];
		availableModels?: SessionModelOption[];
		configOptions?: SessionConfigOption[];
		availableCommands?: AvailableCommand[];
		createdAt?: string;
		updatedAt?: string;
		machineId?: string;
		isCreating?: boolean;
		worktreeSourceCwd?: string;
		worktreeBranch?: string;
		workspaceRootCwd?: string;
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
	streamingThoughtId: undefined,
	sending: false,
	canceling: false,
	error: undefined,
	streamError: undefined,
	createdAt: options?.createdAt,
	updatedAt: options?.updatedAt,
	backendId: options?.backendId,
	backendLabel: options?.backendLabel,
	cwd: options?.cwd,
	additionalDirectories: options?.additionalDirectories,
	agentName: options?.agentName,
	modelId: options?.modelId,
	modelName: options?.modelName,
	modeId: options?.modeId,
	modeName: options?.modeName,
	availableModes: options?.availableModes,
	availableModels: options?.availableModels,
	configOptions: options?.configOptions,
	availableCommands: options?.availableCommands,
	machineId: options?.machineId,
	isCreating: options?.isCreating,
	isAttached: false,
	attachedAt: undefined,
	detachedAt: undefined,
	detachedReason: undefined,
	isLoading: false,
	historySyncing: false,
	historySyncWarning: undefined,
	worktreeSourceCwd: options?.worktreeSourceCwd,
	worktreeBranch: options?.worktreeBranch,
	workspaceRootCwd: options?.workspaceRootCwd,
});

const resetSessionContentForRevision = (
	session: ChatSession,
	revision: number,
): ChatSession => ({
	...session,
	messages: [],
	terminalOutputs: {},
	streamingMessageId: undefined,
	streamingMessageRole: undefined,
	streamingThoughtId: undefined,
	plan: undefined,
	revision,
	lastAppliedSeq: 0,
});

/**
 * Merge a server session summary into an existing local session state.
 * Shared by handleSessionsChanged (added/updated) and syncSessions.
 */
const mergeSessionFromSummary = (
	existing: ChatSession,
	summary: {
		title?: string | null;
		error?: ChatSession["error"];
		createdAt?: string;
		updatedAt?: string;
		backendId?: string;
		backendLabel?: string | null;
		cwd?: string;
		additionalDirectories?: string[];
		agentName?: string | null;
		modelId?: string | null;
		modelName?: string | null;
		modeId?: string | null;
		modeName?: string | null;
		availableModes?: ChatSession["availableModes"];
		availableModels?: ChatSession["availableModels"];
		configOptions?: ChatSession["configOptions"];
		availableCommands?: ChatSession["availableCommands"];
		machineId?: string;
		worktreeSourceCwd?: string | null;
		worktreeBranch?: string | null;
		workspaceRootCwd?: string | null;
		isAttached?: boolean;
		isTitlePinned?: boolean;
		revision?: number;
	},
): ChatSession => {
	const isAttached = summary.isAttached === true;
	const shouldResetForAttachedRevision =
		isAttached &&
		summary.revision !== undefined &&
		existing.revision !== summary.revision;
	const baseSession = shouldResetForAttachedRevision
		? resetSessionContentForRevision(existing, summary.revision!)
		: existing;
	const attachedFields = isAttached
		? {
				isAttached: true as const,
				attachedAt: baseSession.attachedAt ?? new Date().toISOString(),
				detachedAt: undefined,
				detachedReason: undefined,
				...(summary.revision !== undefined && baseSession.revision === undefined
					? { revision: summary.revision, lastAppliedSeq: 0 }
					: {}),
			}
		: {};
	const replacesConfigState = summary.configOptions !== undefined;

	return {
		...baseSession,
		title: summary.title ?? baseSession.title,
		error: summary.error,
		createdAt: summary.createdAt ?? baseSession.createdAt,
		updatedAt: summary.updatedAt ?? baseSession.updatedAt,
		backendId: summary.backendId ?? baseSession.backendId,
		backendLabel: summary.backendLabel ?? baseSession.backendLabel,
		cwd: summary.cwd ?? baseSession.cwd,
		additionalDirectories:
			summary.additionalDirectories ?? baseSession.additionalDirectories,
		workspaceRootCwd: summary.workspaceRootCwd ?? baseSession.workspaceRootCwd,
		agentName: summary.agentName ?? baseSession.agentName,
		modelId: replacesConfigState
			? (summary.modelId ?? undefined)
			: (summary.modelId ?? baseSession.modelId),
		modelName: replacesConfigState
			? (summary.modelName ?? undefined)
			: (summary.modelName ?? baseSession.modelName),
		modeId: summary.modeId ?? baseSession.modeId,
		modeName: summary.modeName ?? baseSession.modeName,
		availableModes: summary.availableModes ?? baseSession.availableModes,
		availableModels: replacesConfigState
			? (summary.availableModels ?? undefined)
			: (summary.availableModels ?? baseSession.availableModels),
		configOptions: summary.configOptions ?? baseSession.configOptions,
		availableCommands:
			summary.availableCommands ?? baseSession.availableCommands,
		machineId: summary.machineId ?? baseSession.machineId,
		isCreating: false,
		isTitlePinned: summary.isTitlePinned ?? baseSession.isTitlePinned,
		worktreeSourceCwd:
			summary.worktreeSourceCwd ?? baseSession.worktreeSourceCwd,
		worktreeBranch: summary.worktreeBranch ?? baseSession.worktreeBranch,
		...attachedFields,
	};
};

const STORAGE_KEY = "mobvibe.chat-store";

const sanitizeMessageForPersist = (message: ChatMessage): ChatMessage => {
	if (isTextMessage(message)) {
		return {
			...message,
			isStreaming: false,
			provisional: false,
			failed: false,
		};
	}
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
	streamingThoughtId: undefined,
	isAttached: false,
	isLoading: false,
	attachedAt: undefined,
	detachedAt: undefined,
	detachedReason: undefined,
	e2eeStatus: undefined,
	plan: undefined,
	historySyncing: false,
	historySyncWarning: undefined,
	// Preserve messages even when cursor is set so detached sessions keep history.
	// Backfill applies only new events based on the cursor.
	messages: session.messages.map(sanitizeMessageForPersist),
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

type ChatStateSetter = Parameters<StateCreator<ChatState>>[0];
type ChatStateUpdate =
	| ChatState
	| Partial<ChatState>
	| ((state: ChatState) => ChatState | Partial<ChatState>);
type FlexibleChatStateSetter = (
	partial: ChatStateUpdate,
	replace?: boolean,
) => void;
type ChatStateFactory = (
	set: ChatStateSetter,
	applySessionEventTransaction: ChatState["applySessionEventTransaction"],
) => ChatState;

const withSessionEventTransactions = (
	createState: ChatStateFactory,
): StateCreator<ChatState> => {
	return (commitSet) => {
		let transactionState: ChatState | undefined;
		let actions: ChatState;
		const commit = commitSet as unknown as FlexibleChatStateSetter;
		const set = ((partial: ChatStateUpdate, replace?: boolean) => {
			if (transactionState === undefined) {
				commit(partial, replace);
				return;
			}

			const nextState =
				typeof partial === "function" ? partial(transactionState) : partial;
			if (Object.is(nextState, transactionState)) return;
			transactionState = replace
				? (nextState as ChatState)
				: { ...transactionState, ...nextState };
		}) as ChatStateSetter;
		const applySessionEventTransaction: ChatState["applySessionEventTransaction"] =
			(event, applyEvent) =>
				commitSet((state) => {
					const session = state.sessions[event.sessionId];
					if (!session) return state;
					if (
						session.revision !== undefined &&
						event.revision < session.revision
					) {
						return state;
					}
					if (
						session.revision === event.revision &&
						(session.lastAppliedSeq ?? 0) >= event.seq
					) {
						return state;
					}

					transactionState = state;
					try {
						applyEvent(actions);
						actions.updateSessionCursor(
							event.sessionId,
							event.revision,
							event.seq,
						);
						return transactionState;
					} finally {
						transactionState = undefined;
					}
				});

		actions = createState(set, applySessionEventTransaction);
		return actions;
	};
};

export const useChatStore = create<ChatState>()(
	persist(
		withSessionEventTransactions((set, applySessionEventTransaction) => ({
			sessions: {},
			activeSessionId: undefined,
			lastCreatedCwd: {},
			appError: undefined,
			syncStatus: "idle",
			lastSyncAt: undefined,
			setActiveSessionId: (value?: string) => set({ activeSessionId: value }),
			setAppError: (value?: ErrorDetail) => set({ appError: value }),
			setLastCreatedCwd: (machineId: string, cwd: string) =>
				set((state) => ({
					lastCreatedCwd: { ...state.lastCreatedCwd, [machineId]: cwd },
				})),
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
			setHistorySyncing: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, historySyncing: value },
						},
					};
				}),
			setHistorySyncWarning: (sessionId, value) =>
				set((state) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, historySyncWarning: value },
						},
					};
				}),
			markSessionAttached: (payload) =>
				set((state) => {
					const session =
						state.sessions[payload.sessionId] ??
						createSessionState(payload.sessionId);

					// Only initialize cursor if revision is provided and not already set
					const shouldInitCursor =
						payload.revision !== undefined && session.revision === undefined;

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
								...(shouldInitCursor
									? { revision: payload.revision, lastAppliedSeq: 0 }
									: {}),
							},
						},
					};
				}),
			markSessionDetached: (payload) =>
				set((state) => {
					const session =
						state.sessions[payload.sessionId] ??
						createSessionState(payload.sessionId);
					const messages =
						session.streamingMessageId || session.streamingThoughtId
							? session.messages.map((message: ChatMessage) => {
									if (
										message.id === session.streamingMessageId &&
										isTextMessage(message)
									) {
										return { ...message, isStreaming: false };
									}
									if (
										message.id === session.streamingThoughtId &&
										message.kind === "thought"
									) {
										return { ...message, isStreaming: false };
									}
									return message;
								})
							: session.messages;
					return {
						sessions: {
							...state.sessions,
							[payload.sessionId]: {
								...session,
								messages,
								isAttached: false,
								detachedAt: payload.detachedAt,
								detachedReason: payload.reason,
								machineId: payload.machineId ?? session.machineId,
								sending: false,
								canceling: false,
								streamingMessageId: undefined,
								streamingMessageRole: undefined,
								streamingThoughtId: undefined,
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
							nextSessions[added.sessionId] = mergeSessionFromSummary(
								existing,
								added,
							);
						} else {
							nextSessions[added.sessionId] = mergeSessionFromSummary(
								createSessionState(added.sessionId, {
									title: added.title,
									backendId: added.backendId,
									backendLabel: added.backendLabel,
									cwd: added.cwd,
									additionalDirectories: added.additionalDirectories,
									agentName: added.agentName,
									modelId: added.modelId,
									modelName: added.modelName,
									modeId: added.modeId,
									modeName: added.modeName,
									availableModes: added.availableModes,
									availableModels: added.availableModels,
									configOptions: added.configOptions,
									availableCommands: added.availableCommands,
									createdAt: added.createdAt,
									updatedAt: added.updatedAt,
									machineId: added.machineId,
									worktreeSourceCwd: added.worktreeSourceCwd,
									worktreeBranch: added.worktreeBranch,
									workspaceRootCwd: added.workspaceRootCwd,
								}),
								added,
							);
						}
					}

					for (const updated of payload.updated) {
						const existing = nextSessions[updated.sessionId];
						if (existing) {
							nextSessions[updated.sessionId] = mergeSessionFromSummary(
								existing,
								updated,
							);
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
								streamingThoughtId: undefined,
								revision: undefined,
								lastAppliedSeq: 0,
							},
						},
					};
				}),
			restoreSessionMessages: (
				sessionId: string,
				messages: ChatMessage[],
				snapshot?: SessionRestoreSnapshot,
			) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages,
								...(snapshot?.lastAppliedSeq !== undefined
									? { lastAppliedSeq: snapshot.lastAppliedSeq }
									: {}),
								...(snapshot?.revision !== undefined
									? { revision: snapshot.revision }
									: {}),
								...(snapshot?.terminalOutputs !== undefined
									? { terminalOutputs: snapshot.terminalOutputs }
									: {}),
								...(snapshot?.streamingMessageId !== undefined
									? { streamingMessageId: snapshot.streamingMessageId }
									: {}),
								...(snapshot?.streamingMessageRole !== undefined
									? { streamingMessageRole: snapshot.streamingMessageRole }
									: {}),
								...(snapshot?.streamingThoughtId !== undefined
									? { streamingThoughtId: snapshot.streamingThoughtId }
									: {}),
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
								additionalDirectories: summary.additionalDirectories,
								availableModes: summary.availableModes,
								availableModels: summary.availableModels,
								configOptions: summary.configOptions,
								availableCommands: summary.availableCommands,
								machineId: summary.machineId,
								worktreeSourceCwd: summary.worktreeSourceCwd,
								worktreeBranch: summary.worktreeBranch,
								workspaceRootCwd: summary.workspaceRootCwd,
							});

						nextSessions[summary.sessionId] = mergeSessionFromSummary(
							existing,
							summary,
						);
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
					if (payload.cwd !== undefined) {
						nextSession.cwd = payload.cwd;
					}
					if (payload.additionalDirectories !== undefined) {
						nextSession.additionalDirectories = payload.additionalDirectories;
					}
					if (payload.workspaceRootCwd !== undefined) {
						nextSession.workspaceRootCwd = payload.workspaceRootCwd;
					}
					if (payload.agentName !== undefined) {
						nextSession.agentName = payload.agentName;
					}
					if (payload.configOptions !== undefined) {
						nextSession.configOptions = payload.configOptions;
						nextSession.modelId = undefined;
						nextSession.modelName = undefined;
						nextSession.availableModels = undefined;
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
					if (payload.worktreeSourceCwd !== undefined) {
						nextSession.worktreeSourceCwd = payload.worktreeSourceCwd;
					}
					if (payload.worktreeBranch !== undefined) {
						nextSession.worktreeBranch = payload.worktreeBranch;
					}
					if (payload.usage !== undefined) {
						nextSession.usage = payload.usage;
					}
					if (payload._meta !== undefined) {
						nextSession._meta = payload._meta;
					}
					if (payload.plan !== undefined) {
						nextSession.plan = payload.plan;
					}
					if (payload.isTitlePinned !== undefined) {
						nextSession.isTitlePinned = payload.isTitlePinned;
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
					const existingMessageIndex = options?.messageId
						? session.messages.findIndex(
								(message) => message.id === options.messageId,
							)
						: -1;
					if (existingMessageIndex >= 0) {
						const existingMessage = session.messages[existingMessageIndex];
						if (
							existingMessage.role !== "user" ||
							existingMessage.kind !== "text" ||
							(!existingMessage.provisional && !existingMessage.failed)
						) {
							return state;
						}

						const messages = [...session.messages];
						messages[existingMessageIndex] = {
							...existingMessage,
							content,
							contentBlocks:
								options?.contentBlocks ?? createDefaultContentBlocks(content),
							provisional: options?.provisional ?? existingMessage.provisional,
							failed: false,
						};
						return {
							sessions: {
								...state.sessions,
								[sessionId]: { ...session, messages },
							},
						};
					}

					const nextMessage = {
						...createMessage("user", content),
						id: options?.messageId ?? createLocalId(),
						isStreaming: false,
						contentBlocks:
							options?.contentBlocks ?? createDefaultContentBlocks(content),
						provisional: options?.provisional ?? false,
						failed: false,
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
			confirmOrAppendUserMessage: (
				sessionId,
				chunk,
				sendMessageId,
				eventSeq,
				protocolMessageId,
			) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					const contentBlock = normalizeContentBlock(chunk);
					const text = contentBlock.type === "text" ? contentBlock.text : "";

					let boundary = 0;
					for (let i = session.messages.length - 1; i >= 0; i--) {
						if (session.messages[i].role === "assistant") {
							boundary = i + 1;
							break;
						}
					}

					if (!sendMessageId && eventSeq !== undefined) {
						let provisionalMatch:
							| { index: number; echoBlocks: ContentBlock[] }
							| undefined;
						for (
							let index = boundary;
							index < session.messages.length;
							index++
						) {
							const message = session.messages[index];
							if (
								message.role !== "user" ||
								message.kind !== "text" ||
								message.provisional !== true ||
								(message.protocolMessageId !== undefined &&
									protocolMessageId !== undefined &&
									message.protocolMessageId !== protocolMessageId)
							) {
								continue;
							}
							const previousEcho = message.legacyServerEchoBlocks ?? [];
							if (
								previousEcho.length > 0 &&
								message.lastServerChunkSeq !== eventSeq - 1
							) {
								continue;
							}
							const echoBlocks = [...previousEcho, contentBlock];
							const expectedBlocks =
								message.contentBlocks ??
								createDefaultContentBlocks(message.content);
							if (isContentBlockSequencePrefix(echoBlocks, expectedBlocks)) {
								provisionalMatch = { index, echoBlocks };
								break;
							}
						}

						if (provisionalMatch) {
							const message = session.messages[provisionalMatch.index];
							if (message.role !== "user" || message.kind !== "text") {
								return state;
							}
							const expectedBlocks =
								message.contentBlocks ??
								createDefaultContentBlocks(message.content);
							const confirmed = areContentBlockSequencesEqual(
								provisionalMatch.echoBlocks,
								expectedBlocks,
							);
							const messages = [...session.messages];
							messages[provisionalMatch.index] = {
								...message,
								...(protocolMessageId !== undefined
									? { protocolMessageId }
									: {}),
								provisional: confirmed ? false : message.provisional,
								failed: confirmed ? false : message.failed,
								legacyServerChunked: confirmed ? undefined : true,
								legacyServerEchoBlocks: confirmed
									? undefined
									: provisionalMatch.echoBlocks,
								lastServerChunkSeq: confirmed ? undefined : eventSeq,
							};
							return {
								sessions: {
									...state.sessions,
									[sessionId]: { ...session, messages },
								},
							};
						}

						const lastMessage = session.messages.at(-1);
						if (
							lastMessage?.role === "user" &&
							lastMessage.kind === "text" &&
							lastMessage.provisional !== true &&
							lastMessage.legacyServerChunked === true &&
							lastMessage.lastServerChunkSeq === eventSeq - 1 &&
							(lastMessage.protocolMessageId === undefined ||
								protocolMessageId === undefined ||
								lastMessage.protocolMessageId === protocolMessageId)
						) {
							const content = `${lastMessage.content}${text}`;
							const messages = [...session.messages];
							messages[messages.length - 1] = {
								...lastMessage,
								...(protocolMessageId !== undefined
									? { protocolMessageId }
									: {}),
								content,
								contentBlocks: appendContentBlock(
									lastMessage.contentBlocks ?? [],
									contentBlock,
								),
								lastServerChunkSeq: eventSeq,
							};
							return {
								sessions: {
									...state.sessions,
									[sessionId]: { ...session, messages },
								},
							};
						}
					}

					let matchIndex = -1;
					if (sendMessageId) {
						matchIndex = session.messages.findIndex(
							(message) =>
								message.id === sendMessageId &&
								message.role === "user" &&
								message.kind === "text" &&
								(message.protocolMessageId === undefined ||
									protocolMessageId === undefined ||
									message.protocolMessageId === protocolMessageId),
						);
					} else if (protocolMessageId) {
						matchIndex = session.messages.findIndex(
							(message, index) =>
								index >= boundary &&
								message.role === "user" &&
								message.kind === "text" &&
								message.protocolMessageId === protocolMessageId,
						);
					}
					if (matchIndex < 0 && !sendMessageId) {
						matchIndex = session.messages.findIndex(
							(message, index) =>
								index >= boundary &&
								message.role === "user" &&
								message.kind === "text" &&
								message.provisional === true &&
								(message.protocolMessageId === undefined ||
									protocolMessageId === undefined ||
									message.protocolMessageId === protocolMessageId) &&
								(contentBlock.type === "text"
									? message.content === text
									: (
											message.contentBlocks ??
											createDefaultContentBlocks(message.content)
										).some((candidate) =>
											isSameContentBlock(candidate, contentBlock),
										)),
						);
					}

					const matchedMessage =
						matchIndex >= 0 ? session.messages[matchIndex] : undefined;
					if (
						matchedMessage?.role === "user" &&
						matchedMessage.kind === "text"
					) {
						if (matchedMessage.provisional !== true) {
							if (!matchedMessage.serverChunked) {
								return state;
							}
							if (
								eventSeq !== undefined &&
								matchedMessage.lastServerChunkSeq !== undefined &&
								eventSeq <= matchedMessage.lastServerChunkSeq
							) {
								return state;
							}
							const existingBlocks = matchedMessage.contentBlocks ?? [];
							if (
								eventSeq === undefined &&
								sendMessageId !== undefined &&
								existingBlocks.some((candidate) =>
									isSameContentBlock(candidate, contentBlock),
								)
							) {
								return state;
							}

							const content = `${matchedMessage.content}${text}`;
							const messages = [...session.messages];
							messages[matchIndex] = {
								...matchedMessage,
								content,
								contentBlocks: appendContentBlock(existingBlocks, contentBlock),
								...(eventSeq !== undefined
									? { lastServerChunkSeq: eventSeq }
									: {}),
							};
							return {
								sessions: {
									...state.sessions,
									[sessionId]: { ...session, messages },
								},
							};
						}
						const messages = [...session.messages];
						messages[matchIndex] = {
							...matchedMessage,
							...(protocolMessageId !== undefined ? { protocolMessageId } : {}),
							provisional: false,
							failed: false,
						};
						return {
							sessions: {
								...state.sessions,
								[sessionId]: { ...session, messages },
							},
						};
					}

					// No provisional found → append new message (backfill scenario)
					const canUseSendMessageId =
						sendMessageId !== undefined &&
						!session.messages.some((message) => message.id === sendMessageId);
					const newMsg: TextMessage = {
						id: canUseSendMessageId ? sendMessageId : createLocalId(),
						role: "user",
						kind: "text",
						content: text,
						contentBlocks: [contentBlock],
						createdAt: new Date().toISOString(),
						isStreaming: false,
						...(protocolMessageId !== undefined ? { protocolMessageId } : {}),
						...(sendMessageId || protocolMessageId
							? {
									serverChunked: true,
									...(eventSeq !== undefined
										? { lastServerChunkSeq: eventSeq }
										: {}),
								}
							: eventSeq !== undefined
								? {
										serverChunked: true,
										legacyServerChunked: true,
										lastServerChunkSeq: eventSeq,
									}
								: {}),
					};
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: [...session.messages, newMsg],
							},
						},
					};
				}),
			markUserMessageFailed: (sessionId, messageId) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) {
						return state;
					}
					let updated = false;
					const messages = session.messages.map((message) => {
						if (
							message.id !== messageId ||
							message.role !== "user" ||
							message.kind !== "text" ||
							message.provisional !== true
						) {
							return message;
						}
						updated = true;
						return { ...message, failed: true };
					});
					if (!updated) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, messages },
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
			appendAssistantChunk: (sessionId, content, protocolMessageId) =>
				set((state: ChatState) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					let { streamingMessageId, streamingMessageRole } = session;
					let messages = session.messages;
					const streamingMessage = streamingMessageId
						? messages.find((message) => message.id === streamingMessageId)
						: undefined;
					const startsNewProtocolMessage =
						protocolMessageId !== undefined &&
						(!streamingMessage ||
							!isTextMessage(streamingMessage) ||
							streamingMessage.protocolMessageId !== protocolMessageId);

					if (
						!streamingMessageId ||
						streamingMessageRole !== "assistant" ||
						startsNewProtocolMessage
					) {
						if (streamingMessageId) {
							messages = messages.map((message) =>
								message.id === streamingMessageId && isTextMessage(message)
									? { ...message, isStreaming: false }
									: message,
							);
						}
						const message = {
							...createMessage("assistant", ""),
							contentBlocks: [],
							...(protocolMessageId !== undefined ? { protocolMessageId } : {}),
						};
						streamingMessageId = message.id;
						streamingMessageRole = "assistant";
						messages = [...messages, message];
					}

					const idx = messages.findIndex((m) => m.id === streamingMessageId);
					if (idx === -1) return state;

					const msg = messages[idx];
					if (!isTextMessage(msg)) return state;

					const contentBlock = normalizeContentBlock(content);
					const nextContent =
						contentBlock.type === "text"
							? `${msg.content}${contentBlock.text}`
							: msg.content;
					const existingBlocks =
						msg.contentBlocks ??
						(msg.content ? createDefaultContentBlocks(msg.content) : []);
					const nextBlocks = appendContentBlock(existingBlocks, contentBlock);

					messages = [
						...messages.slice(0, idx),
						{ ...msg, content: nextContent, contentBlocks: nextBlocks },
						...messages.slice(idx + 1),
					];

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
			appendThoughtChunk: (sessionId, content, protocolMessageId) =>
				set((state: ChatState) => {
					const session =
						state.sessions[sessionId] ?? createSessionState(sessionId);
					let { streamingThoughtId } = session;
					let messages = session.messages;
					const streamingThought = streamingThoughtId
						? messages.find((message) => message.id === streamingThoughtId)
						: undefined;
					const startsNewProtocolMessage =
						protocolMessageId !== undefined &&
						(streamingThought?.kind !== "thought" ||
							streamingThought.protocolMessageId !== protocolMessageId);

					if (!streamingThoughtId || startsNewProtocolMessage) {
						if (streamingThoughtId) {
							messages = messages.map((message) =>
								message.id === streamingThoughtId && message.kind === "thought"
									? { ...message, isStreaming: false }
									: message,
							);
						}
						const thought: ThoughtMessage = {
							id: createLocalId(),
							...(protocolMessageId !== undefined ? { protocolMessageId } : {}),
							role: "assistant",
							kind: "thought",
							content: "",
							contentBlocks: [],
							createdAt: new Date().toISOString(),
							isStreaming: true,
						};
						streamingThoughtId = thought.id;
						messages = [...messages, thought];
					}

					const idx = messages.findIndex((m) => m.id === streamingThoughtId);
					if (idx === -1) return state;

					const msg = messages[idx];
					if (msg.kind !== "thought") return state;

					const contentBlock = normalizeContentBlock(content);
					const nextContent =
						contentBlock.type === "text"
							? `${msg.content}${contentBlock.text}`
							: msg.content;
					const existingBlocks =
						msg.contentBlocks ??
						(msg.content ? createDefaultContentBlocks(msg.content) : []);
					messages = [
						...messages.slice(0, idx),
						{
							...msg,
							content: nextContent,
							contentBlocks: appendContentBlock(existingBlocks, contentBlock),
						},
						...messages.slice(idx + 1),
					];

					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, messages, streamingThoughtId },
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
					if (!session?.streamingMessageId && !session?.streamingThoughtId) {
						return state;
					}
					return {
						sessions: {
							...state.sessions,
							[sessionId]: {
								...session,
								messages: session.messages.map((message: ChatMessage) => {
									if (
										message.id === session.streamingMessageId &&
										isTextMessage(message)
									) {
										return { ...message, isStreaming: false };
									}
									if (
										message.id === session.streamingThoughtId &&
										message.kind === "thought"
									) {
										return { ...message, isStreaming: false };
									}
									return message;
								}),
								streamingMessageId: undefined,
								streamingMessageRole: undefined,
								streamingThoughtId: undefined,
							},
						},
					};
				}),
			applySessionEventTransaction,
			updateSessionCursor: (sessionId, revision, lastAppliedSeq) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					// Reject updates from older revisions (cross-tab storage race)
					if (session.revision !== undefined && revision < session.revision) {
						return state;
					}
					// Monotonic guard: same revision → cursor can only advance
					if (
						session.revision === revision &&
						session.lastAppliedSeq !== undefined &&
						session.lastAppliedSeq >= lastAppliedSeq
					) {
						return state;
					}
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
								streamingThoughtId: undefined,
								plan: undefined,
								revision: newRevision,
								lastAppliedSeq: 0,
							},
						},
					};
				}),
			setSessionE2EEStatus: (sessionId, status) =>
				set((state: ChatState) => {
					const session = state.sessions[sessionId];
					if (!session) return state;
					if (session.e2eeStatus === status) return state;
					return {
						sessions: {
							...state.sessions,
							[sessionId]: { ...session, e2eeStatus: status },
						},
					};
				}),
		})),
		{
			name: STORAGE_KEY,
			version: 1,
			migrate: (persisted, version) => {
				if (version === 0) {
					const state = persisted as Record<string, unknown>;
					// v0 had lastCreatedCwd as string | undefined; discard it
					state.lastCreatedCwd = {};
				}
				return persisted as PersistedChatState;
			},
			partialize: partializeChatState,
			storage: {
				getItem: (name) => {
					const value = getStorageAdapter().getItem(name);
					if (!value) return null;
					try {
						return JSON.parse(value);
					} catch {
						getStorageAdapter().removeItem(name);
						return null;
					}
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
