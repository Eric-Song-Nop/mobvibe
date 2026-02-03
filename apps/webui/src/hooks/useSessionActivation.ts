import type { ChatMessage, ChatSession } from "@mobvibe/core";
import { useCallback, useState } from "react";
import { createFallbackError } from "@/lib/error-utils";
import { useMachinesStore } from "@/lib/machines-store";
import { gatewaySocket } from "@/lib/socket";
import type { ChatStoreActions } from "./useSessionMutations";
import { useSessionMutations } from "./useSessionMutations";

export type ActivationState = "idle" | "loading";

/**
 * Hook for session activation via session/load (or reload when forced).
 * - Attached session: set active immediately (unless forced)
 * - Otherwise: call load/reload, clear local messages, restore on failure
 * - Active session ID is set only after load succeeds
 */
export function useSessionActivation(store: ChatStoreActions) {
	const [activationState, setActivationState] =
		useState<ActivationState>("idle");
	const { loadSessionMutation, reloadSessionMutation } =
		useSessionMutations(store);
	const machines = useMachinesStore((state) => state.machines);

	const activateSession = useCallback(
		async (session: ChatSession, options?: { force?: boolean }) => {
			const force = options?.force === true;
			if (session.isLoading) {
				return;
			}
			if (session.isAttached && !force) {
				store.setActiveSessionId(session.sessionId);
				return;
			}

			if (!session.cwd || !session.machineId) {
				return;
			}
			const capabilities = machines[session.machineId]?.capabilities;
			if (!capabilities?.load) {
				store.setError(
					session.sessionId,
					createFallbackError("Agent does not support session/load", "session"),
				);
				return;
			}

			const params = {
				sessionId: session.sessionId,
				cwd: session.cwd,
				machineId: session.machineId,
			};

			setActivationState("loading");
			store.setSessionLoading(session.sessionId, true);
			const backupMessages: ChatMessage[] = [...session.messages];
			store.clearSessionMessages(session.sessionId);
			gatewaySocket.subscribeToSession(session.sessionId);

			try {
				const mutation = force ? reloadSessionMutation : loadSessionMutation;
				await mutation.mutateAsync(params);
				store.setActiveSessionId(session.sessionId);
			} catch {
				store.restoreSessionMessages(session.sessionId, backupMessages);
				gatewaySocket.unsubscribeFromSession(session.sessionId);
			} finally {
				store.setSessionLoading(session.sessionId, false);
				setActivationState("idle");
			}
		},
		[loadSessionMutation, reloadSessionMutation, machines, store],
	);

	return {
		activateSession,
		isActivating: activationState !== "idle",
		activationState,
	};
}
