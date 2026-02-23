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

export type ActivationPhase = "idle" | "discovering" | "loading" | "reloading";

export type ActivationState = {
	phase: ActivationPhase;
	sessionId?: string;
	machineId?: string;
};

export function useSessionActivation(store: ChatStoreActions) {
	const { t } = useTranslation();
	const { loadSessionMutation, reloadSessionMutation } =
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

			// Per-backend capability check: false → known unsupported, undefined → unknown (proceed optimistically)
			const loadCap = getBackendCapability(machine, fresh.backendId, "load");
			if (loadCap === false) {
				store.setError(
					fresh.sessionId,
					createFallbackError(t("errors.sessionLoadNotSupported"), "session"),
				);
				return;
			}
			// loadCap === true or undefined → proceed, server validates

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
				backendId: fresh.backendId,
				machineId: fresh.machineId,
			};

			store.setSessionLoading(fresh.sessionId, true);
			const backupMessages: ChatMessage[] = [...fresh.messages];
			const backupLastAppliedSeq = fresh.lastAppliedSeq;
			store.clearSessionMessages(fresh.sessionId);
			gatewaySocket.subscribeToSession(fresh.sessionId);

			try {
				const mutation = force ? reloadSessionMutation : loadSessionMutation;
				await mutation.mutateAsync(params);
				store.setActiveSessionId(fresh.sessionId);
			} catch {
				store.restoreSessionMessages(fresh.sessionId, backupMessages, {
					lastAppliedSeq: backupLastAppliedSeq,
				});
				gatewaySocket.unsubscribeFromSession(fresh.sessionId);
			} finally {
				store.setSessionLoading(fresh.sessionId, false);
			}
		},
		[loadSessionMutation, reloadSessionMutation, machines, store, t],
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
		return { phase: "idle" };
	}, [
		loadSessionMutation.isPending,
		loadSessionMutation.variables,
		reloadSessionMutation.isPending,
		reloadSessionMutation.variables,
	]);

	return {
		activateSession,
		activationState,
		isActivating: activationState.phase !== "idle",
	};
}
