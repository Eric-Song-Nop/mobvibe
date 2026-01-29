import type { ChatMessage, ChatSession } from "@mobvibe/core";
import { useCallback, useState } from "react";
import type { ChatStoreActions } from "./useSessionMutations";
import { useSessionMutations } from "./useSessionMutations";

export type ActivationState = "idle" | "resuming" | "loading";

/**
 * Hook for implicit session restoration.
 * When user selects a non-active session, this hook automatically attempts
 * to resume or load it based on the session state.
 *
 * Strategy:
 * - ready/connecting: No action needed, just set active
 * - idle: Try resume (fast, no message replay)
 * - closed/error/stopped: Try load (full, with message replay)
 * - If resume fails, fallback to load
 * - Load clears local messages first (to avoid duplication with replayed messages)
 */
export function useSessionActivation(store: ChatStoreActions) {
	const [activationState, setActivationState] =
		useState<ActivationState>("idle");
	const { resumeSessionMutation, loadSessionMutation } =
		useSessionMutations(store);

	const activateSession = useCallback(
		async (session: ChatSession) => {
			// Already active or connecting, no need to restore
			if (session.state === "ready" || session.state === "connecting") {
				store.setActiveSessionId(session.sessionId);
				return;
			}

			// Missing required info for restore
			if (!session.cwd || !session.machineId) {
				store.setActiveSessionId(session.sessionId);
				return;
			}

			const params = {
				sessionId: session.sessionId,
				cwd: session.cwd,
				machineId: session.machineId,
			};

			// Idle state - try resume first (no message replay, no need to clear)
			if (session.state === "idle") {
				setActivationState("resuming");
				try {
					await resumeSessionMutation.mutateAsync(params);
					setActivationState("idle");
					return;
				} catch {
					// Resume failed, fall through to load
				}
			}

			// Load requires clearing local messages first to avoid duplication
			// Agent will replay message history through session:update events
			setActivationState("loading");
			const backupMessages: ChatMessage[] = [...session.messages];
			store.clearSessionMessages(session.sessionId);

			try {
				await loadSessionMutation.mutateAsync(params);
			} catch {
				// Load failed, restore backed-up messages
				store.restoreSessionMessages(session.sessionId, backupMessages);
				store.setActiveSessionId(session.sessionId);
			}
			setActivationState("idle");
		},
		[resumeSessionMutation, loadSessionMutation, store],
	);

	return {
		activateSession,
		isActivating: activationState !== "idle",
		activationState,
	};
}
