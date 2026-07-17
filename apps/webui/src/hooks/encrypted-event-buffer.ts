import type { SessionEvent } from "@/lib/acp";

export type EventSource = "live" | "backfill";

export type BufferedEncryptedEvent = {
	event: SessionEvent;
	source: EventSource;
};

export function createEncryptedEventBuffer() {
	const buffer = new Map<string, BufferedEncryptedEvent[]>();

	return {
		push(sessionId: string, event: BufferedEncryptedEvent) {
			const events = buffer.get(sessionId) ?? [];
			events.push(event);
			buffer.set(sessionId, events);
		},
		drain(sessionId: string, revision?: number) {
			const events = buffer.get(sessionId) ?? [];
			if (revision === undefined) {
				buffer.delete(sessionId);
				return events;
			}
			const matching = events.filter(
				({ event }) => event.revision === revision,
			);
			const remaining = events.filter(
				({ event }) => event.revision !== revision,
			);
			if (remaining.length > 0) {
				buffer.set(sessionId, remaining);
			} else {
				buffer.delete(sessionId);
			}
			return matching;
		},
		retainRevision(sessionId: string, revision: number) {
			const matching = (buffer.get(sessionId) ?? []).filter(
				({ event }) => event.revision === revision,
			);
			if (matching.length > 0) {
				buffer.set(sessionId, matching);
			} else {
				buffer.delete(sessionId);
			}
		},
		clear(sessionId: string) {
			buffer.delete(sessionId);
		},
	};
}
