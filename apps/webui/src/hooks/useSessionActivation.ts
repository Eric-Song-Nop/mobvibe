import type { ChatMessage, ChatSession } from "@mobvibe/core";
import { useCallback, useState } from "react";
import { createFallbackError } from "@/lib/error-utils";
import { useMachinesStore } from "@/lib/machines-store";
import type { ChatStoreActions } from "./useSessionMutations";
import { useSessionMutations } from "./useSessionMutations";

export type ActivationState = "idle" | "loading";

/**
 * Hook for session activation via session/load (no resume).
 * - Attached session: set active immediately
 * - Otherwise: call load, clear local messages, restore on failure
 * - Active session ID is set only after load succeeds
 */
export function useSessionActivation(store: ChatStoreActions) {
	const [activationState, setActivationState] =
		useState<ActivationState>("idle");
	const { loadSessionMutation } = useSessionMutations(store);
	const machines = useMachinesStore((state) => state.machines);

	const activateSession = useCallback(
		async (session: ChatSession) => {
			if (session.isLoading) {
				return;
			}
			if (session.isAttached) {
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

			try {
				await loadSessionMutation.mutateAsync(params);
				store.setActiveSessionId(session.sessionId);
			} catch {
				store.restoreSessionMessages(session.sessionId, backupMessages);
			} finally {
				store.setSessionLoading(session.sessionId, false);
				setActivationState("idle");
			}
		},
		[loadSessionMutation, machines, store],
	);

	return {
		activateSession,
		isActivating: activationState !== "idle",
		activationState,
	};
}
