import type { ChatMessage } from "@/lib/chat-store";

// --- Display item types ---

type ToolCallMessage = Extract<ChatMessage, { kind: "tool_call" }>;
type ThoughtMessage = Extract<ChatMessage, { kind: "thought" }>;

export type SingleDisplayItem = {
	type: "single";
	message: ChatMessage;
	messageIndex: number;
};

export type ToolCallGroupDisplayItem = {
	type: "tool_call_group";
	items: (ToolCallMessage | ThoughtMessage)[];
	toolCallCount: number;
	messageIndex: number;
	messageEndIndex: number;
};

export type DisplayItem = SingleDisplayItem | ToolCallGroupDisplayItem;

// --- Grouping algorithm ---

/** Message kinds that break a running tool_call group. */
const BREAKING_KINDS = new Set(["text", "permission", "status"]);

/**
 * Groups consecutive tool_call messages into collapsible display items.
 *
 * Rules:
 * - `tool_call` messages start or extend a group.
 * - `thought` messages are "transparent": they are absorbed into the current
 *   group only when a `tool_call` follows (lookahead).
 * - `text`, `permission`, `status`, and `user` messages break the group.
 * - A group with only 1 tool_call is emitted as a `single` item.
 */
export function groupMessages(messages: ChatMessage[]): DisplayItem[] {
	const result: DisplayItem[] = [];
	let i = 0;

	while (i < messages.length) {
		const msg = messages[i];

		// User messages always break groups, regardless of kind.
		if (msg.role === "user" || BREAKING_KINDS.has(msg.kind)) {
			result.push({ type: "single", message: msg, messageIndex: i });
			i++;
			continue;
		}

		if (msg.kind === "tool_call") {
			// Start collecting a potential group.
			const groupStart = i;
			const collected: (ToolCallMessage | ThoughtMessage)[] = [
				msg as ToolCallMessage,
			];
			let toolCallCount = 1;
			i++;

			while (i < messages.length) {
				const next = messages[i];

				// User messages always break groups.
				if (next.role === "user") break;

				if (next.kind === "tool_call") {
					collected.push(next as ToolCallMessage);
					toolCallCount++;
					i++;
					continue;
				}

				if (next.kind === "thought") {
					// Lookahead: absorb thought only if a tool_call follows.
					if (hasToolCallAhead(messages, i + 1)) {
						collected.push(next as ThoughtMessage);
						i++;
						continue;
					}
					// No tool_call ahead — end the group, thought becomes standalone.
					break;
				}

				// Any other kind breaks the group.
				break;
			}

			if (toolCallCount >= 2) {
				result.push({
					type: "tool_call_group",
					items: collected,
					toolCallCount,
					messageIndex: groupStart,
					messageEndIndex: groupStart + collected.length - 1,
				});
			} else {
				// Single tool_call (+ possibly no absorbed thoughts): emit individually.
				for (let j = 0; j < collected.length; j++) {
					result.push({
						type: "single",
						message: collected[j],
						messageIndex: groupStart + j,
					});
				}
			}
			continue;
		}

		// Standalone thought (not preceded by tool_call).
		result.push({ type: "single", message: msg, messageIndex: i });
		i++;
	}

	return result;
}

/**
 * Checks whether a `tool_call` message exists at or after `startIndex`,
 * skipping over consecutive `thought` messages.
 */
function hasToolCallAhead(
	messages: ChatMessage[],
	startIndex: number,
): boolean {
	for (let k = startIndex; k < messages.length; k++) {
		const m = messages[k];
		if (m.role === "user") return false;
		if (m.kind === "tool_call") return true;
		if (m.kind === "thought") continue;
		return false;
	}
	return false;
}

// --- Index mapping for search ---

/**
 * Maps a raw message index to the corresponding displayItem index.
 * Used by the search bar to scroll to the correct virtualizer position.
 */
export function messageIndexToDisplayIndex(
	items: DisplayItem[],
	msgIndex: number,
): number {
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item.type === "single" && item.messageIndex === msgIndex) {
			return i;
		}
		if (
			item.type === "tool_call_group" &&
			msgIndex >= item.messageIndex &&
			msgIndex <= item.messageEndIndex
		) {
			return i;
		}
	}
	// Fallback: return last index.
	return Math.max(0, items.length - 1);
}
