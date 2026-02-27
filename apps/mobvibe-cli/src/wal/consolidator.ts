import type { SessionNotification } from "@agentclientprotocol/sdk";
import { logger } from "../lib/logger.js";
import type { WalStore } from "./wal-store.js";

/**
 * Consolidates WAL events by merging intermediate progress events into
 * anchor events and stubbing out redundant rows.
 *
 * Rows are never deleted — stubs preserve seq continuity.
 * Consolidation runs synchronously after events are written and emitted,
 * so real-time streaming is unaffected.
 */
export class WalConsolidator {
	constructor(private readonly walStore: WalStore) {}

	/**
	 * Merge a completed tool call: update anchor payload with merged state,
	 * stub all tool_call_update rows.
	 */
	consolidateToolCall(
		anchorId: number,
		updateIds: number[],
		anchorPayload: SessionNotification,
		updatePayloads: SessionNotification[],
	): void {
		if (updateIds.length === 0) return;

		const mergedPayload = this.mergeToolCallPayload(
			anchorPayload,
			updatePayloads,
		);
		this.walStore.updateEventPayload(anchorId, mergedPayload);
		this.walStore.stubEventPayloads(updateIds);

		logger.debug(
			{ anchorId, stubbedCount: updateIds.length },
			"consolidate_tool_call",
		);
	}

	/**
	 * Merge consecutive chunk sequences: concatenate text into the first chunk,
	 * stub subsequent chunks.
	 */
	consolidateChunks(
		eventIds: number[],
		payloads: SessionNotification[],
		kind: "agent_message_chunk" | "agent_thought_chunk",
	): void {
		if (eventIds.length <= 1) return;

		// Concatenate all text content
		const texts: string[] = [];
		for (const payload of payloads) {
			const update = payload.update as {
				content?: { type?: string; text?: string };
			};
			if (update.content?.type === "text" && update.content.text) {
				texts.push(update.content.text);
			}
		}

		const fullText = texts.join("");

		// Update first chunk with concatenated text
		const firstPayload = payloads[0];
		const mergedPayload: SessionNotification = {
			...firstPayload,
			update: {
				...firstPayload.update,
				sessionUpdate: kind,
				content: { type: "text", text: fullText },
			} as SessionNotification["update"],
		};

		this.walStore.updateEventPayload(eventIds[0], mergedPayload);
		this.walStore.stubEventPayloads(eventIds.slice(1));

		logger.debug(
			{ kind, firstId: eventIds[0], stubbedCount: eventIds.length - 1 },
			"consolidate_chunks",
		);
	}

	/**
	 * Merge terminal output events: first event gets full output,
	 * subsequent events are stubbed.
	 */
	consolidateTerminalOutput(eventIds: number[], payloads: unknown[]): void {
		if (eventIds.length <= 1) return;

		// Concatenate all deltas and collect the last exitStatus
		const deltas: string[] = [];
		let lastExitStatus: unknown;
		let terminalId: string | undefined;

		for (const payload of payloads) {
			const p = payload as {
				terminalId?: string;
				delta?: string;
				exitStatus?: unknown;
			};
			if (p.delta) {
				deltas.push(p.delta);
			}
			if (p.exitStatus !== undefined && p.exitStatus !== null) {
				lastExitStatus = p.exitStatus;
			}
			if (p.terminalId) {
				terminalId = p.terminalId;
			}
		}

		const fullOutput = deltas.join("");

		// Build merged first event payload
		const mergedPayload: Record<string, unknown> = {
			...(payloads[0] as Record<string, unknown>),
			terminalId,
			truncated: true,
			output: fullOutput,
			delta: fullOutput,
		};
		if (lastExitStatus !== undefined) {
			mergedPayload.exitStatus = lastExitStatus;
		}

		this.walStore.updateEventPayload(eventIds[0], mergedPayload);
		this.walStore.stubEventPayloads(eventIds.slice(1));

		logger.debug(
			{ terminalId, firstId: eventIds[0], stubbedCount: eventIds.length - 1 },
			"consolidate_terminal_output",
		);
	}

	/**
	 * Deduplicate usage updates: keep only the last one, stub all preceding.
	 */
	deduplicateUsageUpdates(eventIds: number[]): void {
		if (eventIds.length <= 1) return;

		// Stub all except the last one
		this.walStore.stubEventPayloads(eventIds.slice(0, -1));

		logger.debug(
			{
				keptId: eventIds[eventIds.length - 1],
				stubbedCount: eventIds.length - 1,
			},
			"deduplicate_usage_updates",
		);
	}

	/**
	 * Merge tool call update payloads into the anchor payload.
	 * Equivalent to WebUI's mergeToolCallMessage: later values override earlier ones,
	 * null/undefined values do not override.
	 */
	private mergeToolCallPayload(
		anchor: SessionNotification,
		updates: SessionNotification[],
	): SessionNotification {
		const anchorUpdate = anchor.update as Record<string, unknown>;
		let merged = { ...anchorUpdate };

		for (const u of updates) {
			const update = u.update as Record<string, unknown>;
			// Only override non-null/undefined values
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

		// Ensure the anchor retains sessionUpdate: "tool_call"
		merged = { ...merged, sessionUpdate: "tool_call" };

		return {
			...anchor,
			update: merged as SessionNotification["update"],
		};
	}
}
