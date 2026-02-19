import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, ChatSession } from "@/lib/chat-store";
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

			if (session.isAttached && !force) {
				store.setActiveSessionId(session.sessionId);
				return;
			}

			if (session.isLoading) {
				return;
			}

			if (!session.cwd || !session.machineId) {
				return;
			}

			const machine = machines[session.machineId];
			if (!machine?.connected) {
				store.setError(
					session.sessionId,
					createFallbackError(t("errors.cliOffline"), "service"),
				);
				return;
			}

			// Per-backend capability check: false → known unsupported, undefined → unknown (proceed optimistically)
			const loadCap = getBackendCapability(machine, session.backendId, "load");
			if (loadCap === false) {
				store.setError(
					session.sessionId,
					createFallbackError(t("errors.sessionLoadNotSupported"), "session"),
				);
				return;
			}
			// loadCap === true or undefined → proceed, server validates

			if (!session.backendId) {
				store.setError(
					session.sessionId,
					createFallbackError(t("errors.missingBackendId"), "session"),
				);
				return;
			}

			const params = {
				sessionId: session.sessionId,
				cwd: session.cwd,
				backendId: session.backendId,
				machineId: session.machineId,
			};

			store.setSessionLoading(session.sessionId, true);
			const backupMessages: ChatMessage[] = [...session.messages];
			const backupLastAppliedSeq = session.lastAppliedSeq;
			store.clearSessionMessages(session.sessionId);
			gatewaySocket.subscribeToSession(session.sessionId);

			try {
				const mutation = force ? reloadSessionMutation : loadSessionMutation;
				await mutation.mutateAsync(params);
				store.setActiveSessionId(session.sessionId);
			} catch {
				store.restoreSessionMessages(session.sessionId, backupMessages, {
					lastAppliedSeq: backupLastAppliedSeq,
				});
				gatewaySocket.unsubscribeFromSession(session.sessionId);
			} finally {
				store.setSessionLoading(session.sessionId, false);
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
