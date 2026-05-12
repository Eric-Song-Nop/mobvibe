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
		drain(sessionId: string) {
			const events = buffer.get(sessionId) ?? [];
			buffer.delete(sessionId);
			return events;
		},
		clear(sessionId: string) {
			buffer.delete(sessionId);
		},
	};
}
