export function createSubscriptionManager() {
	const subscribedSessions = new Set<string>();
	const recoverableSessions = new Set<string>();
	const initialBackfillTriggered = new Set<string>();

	return {
		subscribedSessions,
		recoverableSessions,
		initialBackfillTriggered,
		clearSession(sessionId: string) {
			subscribedSessions.delete(sessionId);
			recoverableSessions.delete(sessionId);
			initialBackfillTriggered.delete(sessionId);
		},
		resetInitialBackfill(sessionId: string) {
			initialBackfillTriggered.delete(sessionId);
		},
	};
}
