/**
 * Sequence generator for monotonically increasing sequence numbers
 * per session/revision combination.
 */
export class SeqGenerator {
	private sequences = new Map<string, number>();

	private buildKey(sessionId: string, revision: number): string {
		return `${sessionId}:${revision}`;
	}

	/**
	 * Initialize the sequence for a session/revision from the last known value.
	 */
	initialize(sessionId: string, revision: number, lastSeq: number): void {
		const key = this.buildKey(sessionId, revision);
		this.sequences.set(key, lastSeq);
	}

	/**
	 * Get the next sequence number for a session/revision.
	 */
	next(sessionId: string, revision: number): number {
		const key = this.buildKey(sessionId, revision);
		const current = this.sequences.get(key) ?? 0;
		const next = current + 1;
		this.sequences.set(key, next);
		return next;
	}

	/**
	 * Get the current (last assigned) sequence number for a session/revision.
	 * Returns 0 if no sequence has been assigned.
	 */
	current(sessionId: string, revision: number): number {
		const key = this.buildKey(sessionId, revision);
		return this.sequences.get(key) ?? 0;
	}

	/**
	 * Reset the sequence for a session/revision (used when revision changes).
	 */
	reset(sessionId: string, revision: number): void {
		const key = this.buildKey(sessionId, revision);
		this.sequences.set(key, 0);
	}

	/**
	 * Clear all sequences for a session (used when session is closed).
	 */
	clearSession(sessionId: string): void {
		for (const key of this.sequences.keys()) {
			if (key.startsWith(`${sessionId}:`)) {
				this.sequences.delete(key);
			}
		}
	}
}
