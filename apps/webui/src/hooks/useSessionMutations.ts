import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
	ContentBlock,
	PermissionOption,
	PermissionOutcome,
	PermissionToolCall,
	SessionsChangedPayload,
	ToolCallUpdate,
} from "@/lib/acp";
import {
	archiveSession,
	bulkArchiveSessions,
	cancelSession,
	createSession,
	loadSession,
	reloadSession,
	renameSession,
	type SessionSummary,
	sendMessage,
	sendPermissionDecision,
	setSessionMode,
	setSessionModel,
} from "@/lib/api";
import type {
	ChatMessage,
	ChatSession,
	PermissionDecisionState,
	StatusVariant,
} from "@/lib/chat-store";
import { useChatStore } from "@/lib/chat-store";
import { createFallbackError, normalizeError } from "@/lib/error-utils";
import { notifyResponseCompleted } from "@/lib/notifications";

type SessionMetadata = Partial<
	Pick<
		ChatSession,
		| "title"
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
		| "availableCommands"
		| "worktreeSourceCwd"
		| "worktreeBranch"
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
	sessions: Record<string, ChatSession>;
	setActiveSessionId: (id: string | undefined) => void;
	setLastCreatedCwd: (machineId: string, cwd: string) => void;
	setSessionLoading: (sessionId: string, value: boolean) => void;
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
	createLocalSession: (sessionId: string, metadata?: SessionMetadata) => void;
	syncSessions: (sessions: SessionSummary[]) => void;
	removeSession: (sessionId: string) => void;
	renameSession: (sessionId: string, title: string) => void;
	setError: (sessionId: string, error?: SessionError) => void;
	setAppError: (error?: SessionError) => void;
	setInput: (sessionId: string, input: string) => void;
	setInputContents: (sessionId: string, contents: ContentBlock[]) => void;
	setSending: (sessionId: string, sending: boolean) => void;
	setCanceling: (sessionId: string, canceling: boolean) => void;
	setStreamError: (sessionId: string, error?: StreamError) => void;
	updateSessionMeta: (
		sessionId: string,
		meta: Partial<
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
				| "usage"
			>
		>,
	) => void;
	addUserMessage: (
		sessionId: string,
		content: string,
		meta?: {
			messageId?: string;
			contentBlocks?: ContentBlock[];
			provisional?: boolean;
		},
	) => void;
	confirmOrAppendUserMessage: (sessionId: string, text: string) => void;
	addStatusMessage: (sessionId: string, status: StatusPayload) => void;
	appendAssistantChunk: (sessionId: string, text: string) => void;
	appendThoughtChunk: (sessionId: string, text: string) => void;
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
	handleSessionsChanged: (payload: SessionsChangedPayload) => void;
	clearSessionMessages: (sessionId: string) => void;
	restoreSessionMessages: (
		sessionId: string,
		messages: ChatMessage[],
		cursor?: { lastAppliedSeq?: number; revision?: number },
	) => void;
	// Session cursor tracking for backfill
	updateSessionCursor: (
		sessionId: string,
		revision: number,
		lastAppliedSeq: number,
	) => void;
	resetSessionForRevision: (sessionId: string, newRevision: number) => void;
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
		availableCommands: summary.availableCommands,
	});
};

/**
 * Hook that manages all session-related mutations.
 * Provides methods for creating, renaming, closing, canceling sessions,
 * as well as setting mode, model, sending messages, and handling permissions.
 */
export function useSessionMutations(store: ChatStoreActions) {
	const { t } = useTranslation();
	const createSessionMutation = useMutation({
		mutationFn: createSession,
		onSuccess: (data) => {
			store.createLocalSession(data.sessionId, {
				title: data.title,
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
				availableCommands: data.availableCommands,
				worktreeSourceCwd: data.worktreeSourceCwd,
				worktreeBranch: data.worktreeBranch,
			});

			store.setActiveSessionId(data.sessionId);
			// Use original repo cwd for lastCreatedCwd so reopening the dialog
			// pre-fills the source repo path, not the worktree path
			const lastCwd = data.worktreeSourceCwd ?? data.cwd;
			if (data.machineId && lastCwd) {
				store.setLastCreatedCwd(data.machineId, lastCwd);
			}
			store.setAppError(undefined);
		},

		onError: (mutationError: unknown) => {
			store.setAppError(
				normalizeError(
					mutationError,
					createFallbackError(t("errors.createSessionFailed"), "service"),
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
					createFallbackError(t("errors.renameSessionFailed"), "session"),
				),
			);
		},
	});

	const archiveSessionMutation = useMutation({
		mutationFn: archiveSession,
		onSuccess: (_, variables) => {
			store.removeSession(variables.sessionId);
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown, variables) => {
			// Remove the session locally even if the gateway rejects the archive,
			// so the user can always get rid of a broken session.
			store.removeSession(variables.sessionId);
			store.setAppError(
				normalizeError(
					mutationError,
					createFallbackError(t("errors.archiveSessionFailed"), "session"),
				),
			);
		},
	});

	const bulkArchiveSessionsMutation = useMutation({
		mutationFn: bulkArchiveSessions,
		onSuccess: (_, variables) => {
			for (const id of variables.sessionIds) {
				store.removeSession(id);
			}
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown, variables) => {
			for (const id of variables.sessionIds) {
				store.removeSession(id);
			}
			store.setAppError(
				normalizeError(
					mutationError,
					createFallbackError(t("errors.bulkArchiveSessionsFailed"), "session"),
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
				title: t("statusMessages.cancelled"),
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
					createFallbackError(t("errors.cancelSessionFailed"), "session"),
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
					createFallbackError(t("errors.switchModeFailed"), "session"),
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
					createFallbackError(t("errors.switchModelFailed"), "session"),
				),
			);
		},
	});

	const sendMessageMutation = useMutation({
		mutationFn: sendMessage,
		onSuccess: (data, variables) => {
			if (!variables) {
				return;
			}
			const shouldNotify =
				data.stopReason === "end_turn" ||
				data.stopReason === "max_tokens" ||
				data.stopReason === "max_turn_requests";
			if (!shouldNotify) {
				return;
			}
			notifyResponseCompleted(
				{ sessionId: variables.sessionId },
				{ sessions: store.sessions },
			);
		},
		onError: (mutationError: unknown) => {
			store.setAppError(
				normalizeError(
					mutationError,
					createFallbackError(t("errors.sendFailed"), "session"),
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
					createFallbackError(t("errors.permissionDecisionFailed"), "session"),
				),
			);
		},
	});

	const createSessionLoadCallbacks = (errorKey: string) => ({
		onSuccess: (data: SessionSummary) => {
			// Only reset if revision actually changed (avoid wiping backfill results)
			if (data.revision !== undefined) {
				const current = useChatStore.getState().sessions[data.sessionId];
				if (!current || current.revision !== data.revision) {
					store.resetSessionForRevision(data.sessionId, data.revision);
				}
			}

			store.updateSessionMeta(data.sessionId, {
				updatedAt: data.updatedAt,
				cwd: data.cwd,
				agentName: data.agentName,
				modelId: data.modelId,
				modelName: data.modelName,
				modeId: data.modeId,
				modeName: data.modeName,
				availableModes: data.availableModes,
				availableModels: data.availableModels,
				availableCommands: data.availableCommands,
			});
			store.setActiveSessionId(data.sessionId);
			store.setAppError(undefined);
		},
		onError: (mutationError: unknown) => {
			store.setAppError(
				normalizeError(
					mutationError,
					createFallbackError(t(errorKey), "session"),
				),
			);
		},
	});

	const loadSessionMutation = useMutation({
		mutationFn: loadSession,
		...createSessionLoadCallbacks("errors.loadSessionFailed"),
	});

	const reloadSessionMutation = useMutation({
		mutationFn: reloadSession,
		...createSessionLoadCallbacks("errors.reloadSessionFailed"),
	});

	return {
		createSessionMutation,
		renameSessionMutation,
		archiveSessionMutation,
		bulkArchiveSessionsMutation,
		cancelSessionMutation,
		setSessionModeMutation,
		setSessionModelMutation,
		sendMessageMutation,
		permissionDecisionMutation,
		loadSessionMutation,
		reloadSessionMutation,
	};
}
