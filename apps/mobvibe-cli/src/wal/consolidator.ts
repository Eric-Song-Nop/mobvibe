import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { SessionEventKind } from "@mobvibe/shared";
import type { WalEvent } from "./wal-store.js";

/**
 * Detect legacy stub payloads (`{_c: true}`) produced by old write-time consolidation.
 */
export function isStubPayload(payload: unknown): boolean {
	if (payload === null || typeof payload !== "object") return false;
	return (payload as Record<string, unknown>)._c === true;
}

/**
 * Pure-function read-time consolidation of WAL events.
 *
 * Rules:
 * 1. Filter out legacy `{_c:true}` stubs (backward compat).
 * 2. Merge consecutive same-kind `agent_message_chunk` / `agent_thought_chunk` → one event.
 * 3. Merge `tool_call` + consecutive same-toolCallId `tool_call_update` that reach terminal status → one `tool_call`.
 * 4. Merge consecutive same-terminalId `terminal_output` → one event.
 * 5. Consecutive `usage_update` → keep only the last.
 * 6. Merged events use the **last** event's `seq`/`id`/`createdAt` (ensures pagination cursor correctness).
 * 7. Incomplete tool_call groups (no terminal status) → pass through as-is.
 * 8. Non-consecutive same-kind events (interrupted by other types) → not merged.
 */
export function consolidateEventsForRead(events: WalEvent[]): WalEvent[] {
	// Step 1: filter stubs
	const filtered = events.filter((e) => !isStubPayload(e.payload));
	if (filtered.length === 0) return [];

	const result: WalEvent[] = [];
	let i = 0;

	while (i < filtered.length) {
		const event = filtered[i];

		switch (event.kind) {
			case "agent_message_chunk":
			case "agent_thought_chunk": {
				const group = collectConsecutive(filtered, i, event.kind);
				result.push(mergeChunks(group));
				i += group.length;
				break;
			}
			case "tool_call": {
				const group = collectToolCallGroup(filtered, i);
				const merged = mergeToolCallGroup(group);
				for (const m of merged) {
					result.push(m);
				}
				i += group.length;
				break;
			}
			case "terminal_output": {
				const terminalId = extractTerminalId(event);
				const group = collectConsecutiveTerminal(filtered, i, terminalId);
				result.push(mergeTerminalOutput(group));
				i += group.length;
				break;
			}
			case "usage_update": {
				const group = collectConsecutive(filtered, i, "usage_update");
				// Keep only the last usage_update
				result.push(group[group.length - 1]);
				i += group.length;
				break;
			}
			default: {
				result.push(event);
				i++;
				break;
			}
		}
	}

	return result;
}

// ========== Private Helpers ==========

/**
 * Collect consecutive events of exactly the same kind starting from startIdx.
 */
function collectConsecutive(
	events: WalEvent[],
	startIdx: number,
	kind: SessionEventKind,
): WalEvent[] {
	const group: WalEvent[] = [];
	for (let i = startIdx; i < events.length; i++) {
		if (events[i].kind !== kind) break;
		group.push(events[i]);
	}
	return group;
}

/**
 * Collect a tool_call followed by consecutive tool_call_update events
 * that share the same toolCallId.
 */
function collectToolCallGroup(
	events: WalEvent[],
	startIdx: number,
): WalEvent[] {
	const anchor = events[startIdx];
	const toolCallId = extractToolCallId(anchor);
	const group: WalEvent[] = [anchor];

	if (!toolCallId) return group;

	for (let i = startIdx + 1; i < events.length; i++) {
		const e = events[i];
		if (e.kind !== "tool_call_update") break;
		if (extractToolCallId(e) !== toolCallId) break;
		group.push(e);
	}
	return group;
}

/**
 * Collect consecutive terminal_output events with the same terminalId.
 */
function collectConsecutiveTerminal(
	events: WalEvent[],
	startIdx: number,
	terminalId: string,
): WalEvent[] {
	const group: WalEvent[] = [];
	for (let i = startIdx; i < events.length; i++) {
		if (events[i].kind !== "terminal_output") break;
		if (extractTerminalId(events[i]) !== terminalId) break;
		group.push(events[i]);
	}
	return group;
}

/**
 * Merge consecutive text chunks into a single event.
 * Uses the last event's metadata (seq, id, createdAt).
 */
function mergeChunks(chunks: WalEvent[]): WalEvent {
	if (chunks.length === 1) return chunks[0];

	const texts: string[] = [];
	for (const chunk of chunks) {
		const notification = chunk.payload as SessionNotification;
		const update = notification?.update as
			| { content?: { type?: string; text?: string } }
			| undefined;
		if (update?.content?.type === "text" && update.content.text != null) {
			texts.push(update.content.text);
		}
	}

	const last = chunks[chunks.length - 1];
	const first = chunks[0];
	const firstPayload = first.payload as SessionNotification;

	const mergedPayload: SessionNotification = {
		...firstPayload,
		update: {
			...firstPayload.update,
			content: { type: "text", text: texts.join("") },
		} as SessionNotification["update"],
	};

	return {
		...last,
		kind: first.kind,
		payload: mergedPayload,
	};
}

/**
 * Merge a tool_call + tool_call_update group.
 * Only merges if the group reaches a terminal status (completed/failed).
 * Otherwise returns all events as-is.
 */
function mergeToolCallGroup(group: WalEvent[]): WalEvent[] {
	if (group.length <= 1) return group;

	// Check if the group reaches terminal status
	const lastUpdate = group[group.length - 1];
	const lastStatus = extractToolCallStatus(lastUpdate);
	if (lastStatus !== "completed" && lastStatus !== "failed") {
		// Not terminal — return as-is
		return group;
	}

	const anchor = group[0];
	const anchorPayload = anchor.payload as SessionNotification;
	const updates = group.slice(1);

	const anchorUpdate = anchorPayload.update as Record<string, unknown>;
	let merged = { ...anchorUpdate };

	for (const u of updates) {
		const notification = u.payload as SessionNotification;
		const update = notification?.update as Record<string, unknown> | undefined;
		if (!update) continue;
		for (const key of Object.keys(update)) {
			if (
				update[key] !== undefined &&
				update[key] !== null &&
				key !== "sessionUpdate"
			) {
				merged[key] = update[key];
			}
		}
	}

	// Ensure merged retains sessionUpdate: "tool_call"
	merged = { ...merged, sessionUpdate: "tool_call" };

	const last = group[group.length - 1];
	const mergedPayload: SessionNotification = {
		...anchorPayload,
		update: merged as SessionNotification["update"],
	};

	return [
		{
			...last,
			kind: "tool_call" as SessionEventKind,
			payload: mergedPayload,
		},
	];
}

/**
 * Merge consecutive terminal_output events.
 * Concatenates delta, keeps last exitStatus.
 */
function mergeTerminalOutput(events: WalEvent[]): WalEvent {
	if (events.length === 1) return events[0];

	const deltas: string[] = [];
	let lastExitStatus: unknown;
	let terminalId: string | undefined;

	for (const e of events) {
		const p = e.payload as {
			terminalId?: string;
			delta?: string;
			exitStatus?: unknown;
		};
		if (p.delta != null) {
			deltas.push(p.delta);
		}
		if (p.exitStatus !== undefined && p.exitStatus !== null) {
			lastExitStatus = p.exitStatus;
		}
		if (p.terminalId) {
			terminalId = p.terminalId;
		}
	}

	const last = events[events.length - 1];
	const fullOutput = deltas.join("");

	const mergedPayload: Record<string, unknown> = {
		...(events[0].payload as Record<string, unknown>),
		terminalId,
		truncated: true,
		output: fullOutput,
		delta: fullOutput,
	};
	if (lastExitStatus !== undefined) {
		mergedPayload.exitStatus = lastExitStatus;
	}

	return {
		...last,
		payload: mergedPayload,
	};
}

function extractToolCallId(event: WalEvent): string | undefined {
	const notification = event.payload as SessionNotification;
	const update = notification?.update as { toolCallId?: string } | undefined;
	return update?.toolCallId;
}

function extractToolCallStatus(event: WalEvent): string | undefined {
	const notification = event.payload as SessionNotification;
	const update = notification?.update as { status?: string } | undefined;
	return update?.status;
}

function extractTerminalId(event: WalEvent): string {
	const p = event.payload as { terminalId?: string };
	return p.terminalId ?? "__default__";
}
