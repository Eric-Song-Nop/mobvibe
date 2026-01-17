import { useMutation } from "@tanstack/react-query";
import type {
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
	ToolCallUpdate,
} from "@/lib/acp";
import {
	cancelSession,
	closeSession,
	createMessageId,
	createSession,
	renameSession,
	type SessionSummary,
	sendMessage,
	sendPermissionDecision,
	setSessionMode,
	setSessionModel,
} from "@/lib/api";
import type {
	ChatSession,
	PermissionDecisionState,
	StatusVariant,
} from "@/lib/chat-store";
import { createFallbackError, normalizeError } from "@/lib/error-utils";

type SessionMetadata = Partial<
	Pick<
		ChatSession,
		| "title"
		| "state"
		| "backendId"
		| "backendLabel"
		| "cwd"
		| "agentName"
		| "modelId"
		| "modelName"
		| "modeId"
		| "modeName"
		| "availableModes"
		| "availableModels"
	>
>;

type SessionError = ChatSession["error"];

type StreamError = ChatSession["streamError"];

type StatusPayload = {
	title: string;
	description?: string;
	variant?: StatusVariant;
};

type PermissionRequestPayload = {
	requestId: string;
	toolCall?: PermissionToolCall;
	options: PermissionOption[];
};

export interface ChatStoreActions {
	setActiveSessionId: (id: string | undefined) => void;
	createLocalSession: (sessionId: string, metadata?: SessionMetadata) => void;
	syncSessions: (sessions: SessionSummary[]) => void;
	removeSession: (sessionId: string) => void;
	renameSession: (sessionId: string, title: string) => void;
	setError: (sessionId: string, error?: SessionError) => void;
	setAppError: (error?: SessionError) => void;
	setInput: (sessionId: string, input: string) => void;
	setSending: (sessionId: string, sending: boolean) => void;
	setCanceling: (sessionId: string, canceling: boolean) => void;
	setStreamError: (sessionId: string, error?: StreamError) => void;
	updateSessionMeta: (sessionId: string, meta: Partial<SessionSummary>) => void;
	addUserMessage: (
		sessionId: string,
		content: string,
		meta?: { messageId?: string },
	) => void;
	addStatusMessage: (sessionId: string, status: StatusPayload) => void;
	appendAssistantChunk: (sessionId: string, text: string) => void;
	finalizeAssistantMessage: (sessionId: string) => void;
	addPermissionRequest: (
		sessionId: string,
		request: PermissionRequestPayload,
	) => void;
	setPermissionDecisionState: (
		sessionId: string,
		requestId: string,
		state: PermissionDecisionState,
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
}

const applySessionSummary = (
	store: ChatStoreActions,
	summary: SessionSummary,
) => {
	store.updateSessionMeta(summary.sessionId, {
		title: summary.title,
		updatedAt: summary.updatedAt,
		cwd: summary.cwd,
		agentName: summary.agentName,
		modelId: summary.modelId,
		modelName: summary.modelName,
		modeId: summary.modeId,
		modeName: summary.modeName,
		availableModes: summary.availableModes,
		availableModels: summary.availableModels,
	});
};

/**
 * Hook that manages all session-related mutations.
 * Provides methods for creating, renaming, closing, canceling sessions,
 * as well as setting mode, model, sending messages, and handling permissions.
 */
export function useSessionMutations(store: ChatStoreActions) {
	const createSessionMutation = useMutation({
		mutationFn: createSession,
		onSuccess: (data) => {
			store.createLocalSession(data.sessionId, {
				title: data.title,
				state: data.state,
				backendId: data.backendId,
				backendLabel: data.backendLabel,
				cwd: data.cwd,
				agentName: data.agentName,
				modelId: data.modelId,
				modelName: data.modelName,
				modeId: data.modeId,
				modeName: data.modeName,
				availableModes: data.availableModes,
				availableModels: data.availableModels,
			});
			store.setActiveSessionId(data.sessionId);
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown) => {
			store.setAppError(
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
			store.setAppError(
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
			store.removeSession(variables.sessionId);
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown) => {
			store.setAppError(
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
			store.setCanceling(variables.sessionId, true);
		},
		onSuccess: (_data, variables) => {
			store.addStatusMessage(variables.sessionId, {
				title: "已取消本次生成",
				variant: "warning",
			});
			store.finalizeAssistantMessage(variables.sessionId);
			store.setSending(variables.sessionId, false);
			store.setCanceling(variables.sessionId, false);
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown, variables) => {
			store.setCanceling(variables.sessionId, false);
			store.setAppError(
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
			applySessionSummary(store, summary);
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown) => {
			store.setAppError(
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
			applySessionSummary(store, summary);
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown) => {
			store.setAppError(
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
			store.setAppError(
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
			store.finalizeAssistantMessage(variables.sessionId);
			store.setSending(variables.sessionId, false);
			store.setCanceling(variables.sessionId, false);
		},
	});

	const createMessageIdMutation = useMutation({
		mutationFn: createMessageId,
		onError: (mutationError: unknown, variables) => {
			store.setSending(variables.sessionId, false);
			store.setCanceling(variables.sessionId, false);
			store.setAppError(
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
			store.setPermissionDecisionState(
				variables.sessionId,
				variables.requestId,
				"submitting",
			);
		},
		onSuccess: (data) => {
			store.setPermissionOutcome(data.sessionId, data.requestId, data.outcome);
			store.setPermissionDecisionState(data.sessionId, data.requestId, "idle");
		},
		onError: (mutationError: unknown, variables) => {
			store.setPermissionDecisionState(
				variables.sessionId,
				variables.requestId,
				"idle",
			);
			store.setAppError(
				normalizeError(
					mutationError,
					createFallbackError("权限处理失败", "session"),
				),
			);
		},
	});

	return {
		createSessionMutation,
		renameSessionMutation,
		closeSessionMutation,
		cancelSessionMutation,
		setSessionModeMutation,
		setSessionModelMutation,
		sendMessageMutation,
		createMessageIdMutation,
		permissionDecisionMutation,
	};
}
