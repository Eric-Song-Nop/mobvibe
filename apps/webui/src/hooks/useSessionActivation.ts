import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	type ChatMessage,
	type ChatSession,
	useChatStore,
} from "@/lib/chat-store";
import { createFallbackError } from "@/lib/error-utils";
import { getBackendCapability, useMachinesStore } from "@/lib/machines-store";
import { gatewaySocket } from "@/lib/socket";
import type { ChatStoreActions } from "./useSessionMutations";
import { useSessionMutations } from "./useSessionMutations";

export type ActivationPhase =
	| "idle"
	| "discovering"
	| "loading"
	| "resuming"
	| "reloading";

export type ActivationState = {
	phase: ActivationPhase;
	sessionId?: string;
	machineId?: string;
};

export function useSessionActivation(store: ChatStoreActions) {
	const { t } = useTranslation();
	const { loadSessionMutation, reloadSessionMutation, resumeSessionMutation } =
		useSessionMutations(store);
	const machines = useMachinesStore((state) => state.machines);

	const activateSession = useCallback(
		async (session: ChatSession, options?: { force?: boolean }) => {
			const force = options?.force === true;

			// Read fresh state from store to avoid stale closure/props
			// (prevents concurrent mutations on rapid double-click)
			const fresh = useChatStore.getState().sessions[session.sessionId];
			if (!fresh) return;

			if (fresh.isAttached && !force) {
				store.setActiveSessionId(fresh.sessionId);
				return;
			}

			if (fresh.isLoading) {
				return;
			}

			if (!fresh.cwd || !fresh.machineId) {
				return;
			}

			const machine = machines[fresh.machineId];
			if (!machine?.connected) {
				store.setError(
					fresh.sessionId,
					createFallbackError(t("errors.cliOffline"), "service"),
				);
				return;
			}

			// Unknown capabilities proceed optimistically through load. Resume is used
			// only when explicitly advertised because it intentionally skips replay.
			const loadCap = getBackendCapability(machine, fresh.backendId, "load");
			const resumeCap = getBackendCapability(
				machine,
				fresh.backendId,
				"resume",
			);
			const hasLocalHistory =
				fresh.revision !== undefined &&
				((fresh.lastAppliedSeq ?? 0) > 0 || fresh.messages.length > 0);
			const shouldResume =
				!force && resumeCap === true && (hasLocalHistory || loadCap === false);
			if ((force || !shouldResume) && loadCap === false) {
				store.setError(
					fresh.sessionId,
					createFallbackError(
						t(
							force
								? "errors.sessionLoadNotSupported"
								: "errors.sessionActivationNotSupported",
						),
						"session",
					),
				);
				return;
			}

			if (!fresh.backendId) {
				store.setError(
					fresh.sessionId,
					createFallbackError(t("errors.missingBackendId"), "session"),
				);
				return;
			}

			const params = {
				sessionId: fresh.sessionId,
				cwd: fresh.cwd,
				...(fresh.additionalDirectories !== undefined
					? { additionalDirectories: fresh.additionalDirectories }
					: {}),
				backendId: fresh.backendId,
				machineId: fresh.machineId,
			};

			store.setSessionLoading(fresh.sessionId, true);
			gatewaySocket.subscribeToSession(fresh.sessionId);
			if (shouldResume) {
				try {
					await resumeSessionMutation.mutateAsync(params);
					store.setActiveSessionId(fresh.sessionId);
				} catch {
					gatewaySocket.unsubscribeFromSession(fresh.sessionId);
				} finally {
					store.setSessionLoading(fresh.sessionId, false);
				}
				return;
			}

			store.setHistorySyncing(fresh.sessionId, true);
			store.setHistorySyncWarning(fresh.sessionId, undefined);
			const backupMessages: ChatMessage[] = [...fresh.messages];
			const backupSnapshot = {
				lastAppliedSeq: fresh.lastAppliedSeq,
				revision: fresh.revision,
				terminalOutputs: { ...fresh.terminalOutputs },
				streamingMessageId: fresh.streamingMessageId,
				streamingMessageRole: fresh.streamingMessageRole,
				streamingThoughtId: fresh.streamingThoughtId,
			};
			store.clearSessionMessages(fresh.sessionId);
			try {
				const mutation = force ? reloadSessionMutation : loadSessionMutation;
				await mutation.mutateAsync(params);
				store.setActiveSessionId(fresh.sessionId);
			} catch {
				store.restoreSessionMessages(
					fresh.sessionId,
					backupMessages,
					backupSnapshot,
				);
				store.setHistorySyncing(fresh.sessionId, false);
				gatewaySocket.unsubscribeFromSession(fresh.sessionId);
			} finally {
				store.setSessionLoading(fresh.sessionId, false);
			}
		},
		[
			loadSessionMutation,
			reloadSessionMutation,
			resumeSessionMutation,
			machines,
			store,
			t,
		],
	);

	const activationState = useMemo<ActivationState>(() => {
		if (loadSessionMutation.isPending && loadSessionMutation.variables) {
			return {
				phase: "loading",
				sessionId: loadSessionMutation.variables.sessionId,
			};
		}
		if (reloadSessionMutation.isPending && reloadSessionMutation.variables) {
			return {
				phase: "reloading",
				sessionId: reloadSessionMutation.variables.sessionId,
			};
		}
		if (resumeSessionMutation.isPending && resumeSessionMutation.variables) {
			return {
				phase: "resuming",
				sessionId: resumeSessionMutation.variables.sessionId,
			};
		}
		return { phase: "idle" };
	}, [
		loadSessionMutation.isPending,
		loadSessionMutation.variables,
		reloadSessionMutation.isPending,
		reloadSessionMutation.variables,
		resumeSessionMutation.isPending,
		resumeSessionMutation.variables,
	]);

	return {
		activateSession,
		activationState,
		isActivating: activationState.phase !== "idle",
	};
}
