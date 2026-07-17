import { beforeEach, describe, expect, it } from "bun:test";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { SessionEventKind } from "@mobvibe/shared";
import { consolidateEventsForRead, isStubPayload } from "../consolidator.js";
import type { WalEvent } from "../wal-store.js";

// ========== Test Helpers ==========

const SESSION_ID = "session-1";
const REVISION = 1;
let seqCounter = 0;

const makeEvent = (
	kind: SessionEventKind,
	payload: unknown,
	seqOverride?: number,
): WalEvent => {
	seqCounter++;
	const seq = seqOverride ?? seqCounter;
	return {
		id: seq,
		sessionId: SESSION_ID,
		revision: REVISION,
		seq,
		kind,
		payload,
		createdAt: new Date().toISOString(),
	};
};

const makeChunkPayload = (
	text: string,
	kind: "agent_message_chunk" | "agent_thought_chunk",
	messageId?: string | null,
): SessionNotification =>
	({
		sessionId: SESSION_ID,
		update: {
			sessionUpdate: kind,
			content: { type: "text", text },
			...(messageId !== undefined ? { messageId } : {}),
		},
	}) as unknown as SessionNotification;

const makeToolCallPayload = (
	toolCallId: string,
	fields?: Record<string, unknown>,
): SessionNotification =>
	({
		sessionId: SESSION_ID,
		update: {
			sessionUpdate: "tool_call",
			toolCallId,
			title: "Read file",
			status: "pending",
			...fields,
		},
	}) as unknown as SessionNotification;

const makeToolCallUpdatePayload = (
	toolCallId: string,
	fields?: Record<string, unknown>,
): SessionNotification =>
	({
		sessionId: SESSION_ID,
		update: {
			sessionUpdate: "tool_call_update",
			toolCallId,
			...fields,
		},
	}) as unknown as SessionNotification;

const makeUsagePayload = (used: number, size: number): SessionNotification =>
	({
		sessionId: SESSION_ID,
		update: {
			sessionUpdate: "usage_update",
			used,
			size,
		},
	}) as unknown as SessionNotification;

const makeTerminalPayload = (
	terminalId: string,
	delta: string,
	exitStatus?: unknown,
): Record<string, unknown> => {
	const p: Record<string, unknown> = { terminalId, delta };
	if (exitStatus !== undefined) {
		p.exitStatus = exitStatus;
	}
	return p;
};

// Reset counter before each test
beforeEach(() => {
	seqCounter = 0;
});

// ========== Tests ==========

describe("consolidateEventsForRead", () => {
	// 1. Empty array
	it("should return empty array for empty input", () => {
		expect(consolidateEventsForRead([])).toEqual([]);
	});

	// 2. Single event
	it("should return single event as-is", () => {
		const event = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("hello", "agent_message_chunk"),
		);
		const result = consolidateEventsForRead([event]);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(event);
	});

	// 3. Consecutive agent_message_chunk
	it("should merge consecutive agent_message_chunk events", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("Hello ", "agent_message_chunk"),
		);
		const e2 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("world", "agent_message_chunk"),
		);
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("!", "agent_message_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(1);

		const merged = result[0];
		// Uses last event's seq
		expect(merged.seq).toBe(e3.seq);
		expect(merged.id).toBe(e3.id);
		expect(merged.kind).toBe("agent_message_chunk");

		const update = (merged.payload as SessionNotification).update as Record<
			string,
			unknown
		>;
		const content = update.content as { text: string };
		expect(content.text).toBe("Hello world!");
	});

	it("merges only chunks with the same ACP messageId", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("first ", "agent_message_chunk", "acp-message-1"),
		);
		const e2 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("message", "agent_message_chunk", "acp-message-1"),
		);
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("second", "agent_message_chunk", "acp-message-2"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);

		expect(result).toHaveLength(2);
		const firstUpdate = (result[0].payload as SessionNotification).update as {
			messageId?: string;
			content: { text: string };
		};
		const secondUpdate = (result[1].payload as SessionNotification).update as {
			messageId?: string;
		};
		expect(firstUpdate.messageId).toBe("acp-message-1");
		expect(secondUpdate.messageId).toBe("acp-message-2");
		const firstContent = firstUpdate.content;
		expect(firstContent.text).toBe("first message");
	});

	it("does not merge identified chunks with legacy chunks", () => {
		const identified = makeEvent(
			"agent_thought_chunk",
			makeChunkPayload("identified", "agent_thought_chunk", "thought-1"),
		);
		const legacy = makeEvent(
			"agent_thought_chunk",
			makeChunkPayload("legacy", "agent_thought_chunk"),
		);

		expect(consolidateEventsForRead([identified, legacy])).toHaveLength(2);
	});

	// 4. Consecutive agent_thought_chunk
	it("should merge consecutive agent_thought_chunk events", () => {
		const e1 = makeEvent(
			"agent_thought_chunk",
			makeChunkPayload("Think ", "agent_thought_chunk"),
		);
		const e2 = makeEvent(
			"agent_thought_chunk",
			makeChunkPayload("deep", "agent_thought_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2]);
		expect(result).toHaveLength(1);
		expect(result[0].seq).toBe(e2.seq);
		expect(result[0].kind).toBe("agent_thought_chunk");

		const update = (result[0].payload as SessionNotification).update as Record<
			string,
			unknown
		>;
		const content = update.content as { text: string };
		expect(content.text).toBe("Think deep");
	});

	// 5. Mixed chunk types alternating
	it("should not merge different chunk types", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("msg1", "agent_message_chunk"),
		);
		const e2 = makeEvent(
			"agent_thought_chunk",
			makeChunkPayload("thought1", "agent_thought_chunk"),
		);
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("msg2", "agent_message_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(3);
		expect(result[0].kind).toBe("agent_message_chunk");
		expect(result[1].kind).toBe("agent_thought_chunk");
		expect(result[2].kind).toBe("agent_message_chunk");
	});

	// 6. tool_call + updates (completed)
	it("should merge tool_call + updates when completed", () => {
		const e1 = makeEvent(
			"tool_call",
			makeToolCallPayload("tc-1", { status: "pending", title: "Read" }),
		);
		const e2 = makeEvent(
			"tool_call_update",
			makeToolCallUpdatePayload("tc-1", { output: "data" }),
		);
		const e3 = makeEvent(
			"tool_call_update",
			makeToolCallUpdatePayload("tc-1", {
				status: "completed",
				output: "final",
			}),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(1);
		expect(result[0].seq).toBe(e3.seq);
		expect(result[0].kind).toBe("tool_call");

		const update = (result[0].payload as SessionNotification).update as Record<
			string,
			unknown
		>;
		expect(update.sessionUpdate).toBe("tool_call");
		expect(update.status).toBe("completed");
		expect(update.output).toBe("final");
		expect(update.toolCallId).toBe("tc-1");
	});

	// 7. tool_call + updates (incomplete — no terminal status)
	it("should not merge tool_call when not at terminal status", () => {
		const e1 = makeEvent(
			"tool_call",
			makeToolCallPayload("tc-2", { status: "pending" }),
		);
		const e2 = makeEvent(
			"tool_call_update",
			makeToolCallUpdatePayload("tc-2", { output: "partial" }),
		);

		const result = consolidateEventsForRead([e1, e2]);
		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe("tool_call");
		expect(result[1].kind).toBe("tool_call_update");
	});

	// 8. Multiple different toolCallIds
	it("should handle different toolCallIds independently", () => {
		const e1 = makeEvent("tool_call", makeToolCallPayload("tc-a"));
		const e2 = makeEvent(
			"tool_call_update",
			makeToolCallUpdatePayload("tc-a", { status: "completed" }),
		);
		const e3 = makeEvent("tool_call", makeToolCallPayload("tc-b"));
		const e4 = makeEvent(
			"tool_call_update",
			makeToolCallUpdatePayload("tc-b", { status: "failed" }),
		);

		const result = consolidateEventsForRead([e1, e2, e3, e4]);
		// tc-a merges into 1, tc-b merges into 1
		expect(result).toHaveLength(2);
		expect(result[0].seq).toBe(e2.seq);
		expect(result[1].seq).toBe(e4.seq);
	});

	// 9. Consecutive terminal_output same terminalId
	it("should merge consecutive terminal_output with same terminalId", () => {
		const e1 = makeEvent(
			"terminal_output",
			makeTerminalPayload("term-1", "line 1\n"),
		);
		const e2 = makeEvent(
			"terminal_output",
			makeTerminalPayload("term-1", "line 2\n"),
		);
		const e3 = makeEvent(
			"terminal_output",
			makeTerminalPayload("term-1", "done", 0),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(1);
		expect(result[0].seq).toBe(e3.seq);

		const p = result[0].payload as Record<string, unknown>;
		expect(p.delta).toBe("line 1\nline 2\ndone");
		expect(p.output).toBe("line 1\nline 2\ndone");
		expect(p.exitStatus).toBe(0);
		expect(p.terminalId).toBe("term-1");
	});

	// 10. terminal_output different terminalIds
	it("should not merge terminal_output with different terminalIds", () => {
		const e1 = makeEvent(
			"terminal_output",
			makeTerminalPayload("term-a", "a-output"),
		);
		const e2 = makeEvent(
			"terminal_output",
			makeTerminalPayload("term-b", "b-output"),
		);

		const result = consolidateEventsForRead([e1, e2]);
		expect(result).toHaveLength(2);
	});

	// 11. Consecutive usage_update
	it("should keep only the last usage_update", () => {
		const e1 = makeEvent("usage_update", makeUsagePayload(100, 1000));
		const e2 = makeEvent("usage_update", makeUsagePayload(200, 1000));
		const e3 = makeEvent("usage_update", makeUsagePayload(300, 1000));

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(e3);
	});

	it("passes plan operations through in order alongside legacy plans", () => {
		const legacyPlan = makeEvent("session_info_update", {
			sessionId: SESSION_ID,
			update: {
				sessionUpdate: "plan",
				entries: [
					{
						content: "Legacy step",
						priority: "medium",
						status: "pending",
					},
				],
			},
		});
		const firstUpdate = makeEvent("plan_update", {
			sessionId: SESSION_ID,
			update: {
				sessionUpdate: "plan_update",
				plan: {
					type: "markdown",
					planId: "design",
					content: "## First revision",
				},
			},
		});
		const secondUpdate = makeEvent("plan_update", {
			sessionId: SESSION_ID,
			update: {
				sessionUpdate: "plan_update",
				plan: {
					type: "markdown",
					planId: "design",
					content: "## Second revision",
				},
			},
		});
		const removed = makeEvent("plan_removed", {
			sessionId: SESSION_ID,
			update: { sessionUpdate: "plan_removed", planId: "design" },
		});

		const result = consolidateEventsForRead([
			legacyPlan,
			firstUpdate,
			secondUpdate,
			removed,
		]);

		expect(result).toEqual([legacyPlan, firstUpdate, secondUpdate, removed]);
		expect(result.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
		expect(result[1]).toBe(firstUpdate);
		expect(result[2]).toBe(secondUpdate);
		expect(result[3]).toBe(removed);
	});

	// 12. Stub payloads are filtered
	it("should filter out legacy {_c:true} stub payloads", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("keep", "agent_message_chunk"),
		);
		const e2 = makeEvent("agent_message_chunk", { _c: true });
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("also keep", "agent_message_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		// e2 is filtered, then e1 and e3 are consecutive same-kind → merged
		expect(result).toHaveLength(1);
		const update = (result[0].payload as SessionNotification).update as Record<
			string,
			unknown
		>;
		const content = update.content as { text: string };
		expect(content.text).toBe("keepalso keep");
	});

	// 13. Non-consecutive same-kind (interrupted by other type)
	it("should not merge same-kind events that are interrupted by another type", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("a", "agent_message_chunk"),
		);
		const e2 = makeEvent("turn_end", { stopReason: "end_turn" });
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("b", "agent_message_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(3);
	});

	// 14. Merged seq correctness for pagination
	it("should use last event seq for nextAfterSeq correctness", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("1", "agent_message_chunk"),
		);
		const e2 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("2", "agent_message_chunk"),
		);
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("3", "agent_message_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(1);
		// seq should be e3's seq so nextAfterSeq skips all merged events
		expect(result[0].seq).toBe(e3.seq);
		expect(result[0].id).toBe(e3.id);
		expect(result[0].createdAt).toBe(e3.createdAt);
	});

	// 15. Idempotency
	it("should be idempotent — re-running on consolidated output produces same result", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("Hello ", "agent_message_chunk"),
		);
		const e2 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("world", "agent_message_chunk"),
		);

		const first = consolidateEventsForRead([e1, e2]);
		const second = consolidateEventsForRead(first);
		expect(second).toEqual(first);
	});

	// 16. Unicode/emoji text concatenation
	it("should correctly concatenate Unicode and emoji text", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("你好 ", "agent_message_chunk"),
		);
		const e2 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("🌍🎉", "agent_message_chunk"),
		);
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload(" café", "agent_message_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(1);
		const update = (result[0].payload as SessionNotification).update as Record<
			string,
			unknown
		>;
		const content = update.content as { text: string };
		expect(content.text).toBe("你好 🌍🎉 café");
	});

	// 17. Non-text chunks form boundaries and are never rewritten as text.
	it("does not merge across non-text content boundaries", () => {
		const before = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("before", "agent_message_chunk", "message-1"),
		);
		const imagePayload = {
			sessionId: SESSION_ID,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "image", url: "http://example.com/img.png" },
				messageId: "message-1",
			},
		} as unknown as SessionNotification;

		const image = makeEvent("agent_message_chunk", imagePayload);
		const after = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("after", "agent_message_chunk", "message-1"),
		);

		const result = consolidateEventsForRead([before, image, after]);
		expect(result).toHaveLength(3);
		expect(result[0]).toBe(before);
		expect(result[1]).toBe(image);
		expect(result[2]).toBe(after);
	});

	// 18. Empty string delta / text
	it("should preserve empty string deltas and text", () => {
		const e1 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("", "agent_message_chunk"),
		);
		const e2 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("content", "agent_message_chunk"),
		);
		const e3 = makeEvent(
			"agent_message_chunk",
			makeChunkPayload("", "agent_message_chunk"),
		);

		const result = consolidateEventsForRead([e1, e2, e3]);
		expect(result).toHaveLength(1);
		const update = (result[0].payload as SessionNotification).update as Record<
			string,
			unknown
		>;
		const content = update.content as { text: string };
		// Empty strings are included via text != null check
		expect(content.text).toBe("content");
	});

	// tool_call with "failed" status also triggers merge
	it("should merge tool_call group when status is failed", () => {
		const e1 = makeEvent(
			"tool_call",
			makeToolCallPayload("tc-f", { status: "pending" }),
		);
		const e2 = makeEvent(
			"tool_call_update",
			makeToolCallUpdatePayload("tc-f", {
				status: "failed",
				error: "timeout",
			}),
		);

		const result = consolidateEventsForRead([e1, e2]);
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe("tool_call");

		const update = (result[0].payload as SessionNotification).update as Record<
			string,
			unknown
		>;
		expect(update.status).toBe("failed");
		expect(update.error).toBe("timeout");
	});

	// All stubs filtered → empty result
	it("should return empty when all events are stubs", () => {
		const e1 = makeEvent("agent_message_chunk", { _c: true });
		const e2 = makeEvent("agent_message_chunk", { _c: true });

		const result = consolidateEventsForRead([e1, e2]);
		expect(result).toEqual([]);
	});

	// Mixed event types in realistic sequence
	it("should handle a realistic mixed event sequence", () => {
		const events = [
			makeEvent(
				"agent_message_chunk",
				makeChunkPayload("Hello", "agent_message_chunk"),
			),
			makeEvent(
				"agent_message_chunk",
				makeChunkPayload(" world", "agent_message_chunk"),
			),
			makeEvent(
				"tool_call",
				makeToolCallPayload("tc-1", { status: "pending" }),
			),
			makeEvent(
				"tool_call_update",
				makeToolCallUpdatePayload("tc-1", {
					status: "completed",
					output: "ok",
				}),
			),
			makeEvent("usage_update", makeUsagePayload(100, 1000)),
			makeEvent("usage_update", makeUsagePayload(200, 1000)),
			makeEvent("terminal_output", makeTerminalPayload("t1", "output1\n")),
			makeEvent("terminal_output", makeTerminalPayload("t1", "output2\n", 0)),
			makeEvent("turn_end", { stopReason: "end_turn" }),
		];

		const result = consolidateEventsForRead(events);
		// 2 chunks → 1, 2 tool events → 1, 2 usage → 1, 2 terminal → 1, turn_end → 1
		expect(result).toHaveLength(5);
		expect(result[0].kind).toBe("agent_message_chunk");
		expect(result[1].kind).toBe("tool_call");
		expect(result[2].kind).toBe("usage_update");
		expect(result[3].kind).toBe("terminal_output");
		expect(result[4].kind).toBe("turn_end");
	});
});

describe("isStubPayload", () => {
	it("should detect {_c: true} as stub", () => {
		expect(isStubPayload({ _c: true })).toBe(true);
	});

	it("should not flag normal payloads as stub", () => {
		expect(isStubPayload({ text: "hello" })).toBe(false);
		expect(isStubPayload(null)).toBe(false);
		expect(isStubPayload(undefined)).toBe(false);
		expect(isStubPayload("string")).toBe(false);
		expect(isStubPayload(42)).toBe(false);
	});

	it("should not flag {_c: false} as stub", () => {
		expect(isStubPayload({ _c: false })).toBe(false);
	});
});
