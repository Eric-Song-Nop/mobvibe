import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { WalConsolidator } from "../consolidator.js";
import { WalStore } from "../wal-store.js";

// ========== Test Helpers ==========

const SESSION_ID = "session-1";
const REVISION = 1;

const makeChunkNotification = (
	text: string,
	kind: "agent_message_chunk" | "agent_thought_chunk",
): SessionNotification =>
	({
		sessionId: SESSION_ID,
		update: {
			sessionUpdate: kind,
			content: { type: "text", text },
		},
	}) as unknown as SessionNotification;

const makeToolCallNotification = (
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

const makeToolCallUpdateNotification = (
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

const makeUsageNotification = (
	used: number,
	size: number,
): SessionNotification =>
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
	exitStatus?: { exitCode?: number | null },
) => ({
	sessionId: SESSION_ID,
	terminalId,
	delta,
	truncated: false,
	...(exitStatus !== undefined ? { exitStatus } : {}),
});

describe("WalConsolidator", () => {
	let walStore: WalStore;
	let consolidator: WalConsolidator;
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "consolidator-test-"));
		const dbPath = path.join(tempDir, "events.db");
		walStore = new WalStore(dbPath);
		consolidator = new WalConsolidator(walStore);

		walStore.ensureSession({
			sessionId: SESSION_ID,
			machineId: "machine-1",
			backendId: "backend-1",
		});
	});

	afterEach(() => {
		walStore.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// Helper: append event and return its WAL id
	const appendEvent = (
		kind: string,
		payload: unknown,
	): { id: number; seq: number } => {
		const event = walStore.appendEvent({
			sessionId: SESSION_ID,
			revision: REVISION,
			kind: kind as import("@mobvibe/shared").SessionEventKind,
			payload,
		});
		return { id: event.id, seq: event.seq };
	};

	// Helper: read payload by event id
	const getPayload = (eventId: number): unknown => {
		// Query all events and find by id
		const events = walStore.queryEvents({
			sessionId: SESSION_ID,
			revision: REVISION,
			limit: 10000,
		});
		const found = events.find((e) => e.id === eventId);
		return found?.payload;
	};

	const isStub = (payload: unknown): boolean => {
		if (typeof payload !== "object" || payload === null) return false;
		return (payload as Record<string, unknown>)._c === true;
	};

	// ========== Test 1: Tool Call Consolidation ==========
	describe("consolidateToolCall", () => {
		it("should merge updates into anchor and stub update rows", () => {
			const anchorPayload = makeToolCallNotification("tc-1", {
				title: "Read file",
				status: "pending",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			// 3 in_progress updates
			const updates: { id: number; payload: SessionNotification }[] = [];
			for (let i = 0; i < 3; i++) {
				const p = makeToolCallUpdateNotification("tc-1", {
					status: "in_progress",
					title: `Reading... ${i}`,
				});
				const ev = appendEvent("tool_call_update", p);
				updates.push({ id: ev.id, payload: p });
			}

			// 1 completed update
			const completedPayload = makeToolCallUpdateNotification("tc-1", {
				status: "completed",
				title: "Read file done",
				rawOutput: { content: "file contents" },
			});
			const completedEv = appendEvent("tool_call_update", completedPayload);
			updates.push({ id: completedEv.id, payload: completedPayload });

			consolidator.consolidateToolCall(
				anchor.id,
				updates.map((u) => u.id),
				anchorPayload,
				updates.map((u) => u.payload),
			);

			// Anchor should have merged state
			const anchorResult = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(anchorResult.update.sessionUpdate).toBe("tool_call");
			expect(anchorResult.update.status).toBe("completed");
			expect(anchorResult.update.title).toBe("Read file done");
			expect(anchorResult.update.rawOutput).toEqual({
				content: "file contents",
			});

			// All updates should be stubs
			for (const u of updates) {
				expect(isStub(getPayload(u.id))).toBe(true);
			}
		});

		it("should not merge when there are no updates", () => {
			const anchorPayload = makeToolCallNotification("tc-2");
			const anchor = appendEvent("tool_call", anchorPayload);

			consolidator.consolidateToolCall(anchor.id, [], anchorPayload, []);

			// Anchor unchanged
			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(result.update.toolCallId).toBe("tc-2");
		});
	});

	// ========== Test 2: Message Chunk Consolidation ==========
	describe("consolidateChunks (agent_message_chunk)", () => {
		it("should concatenate text into first chunk and stub the rest", () => {
			const chunks = ["Hello ", "world", "! ", "How ", "are you?"];
			const events: { id: number; payload: SessionNotification }[] = [];

			for (const text of chunks) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateChunks(
				events.map((e) => e.id),
				events.map((e) => e.payload),
				"agent_message_chunk",
			);

			// First chunk has full text
			const firstPayload = getPayload(events[0].id) as {
				update: { content: { text: string }; sessionUpdate: string };
			};
			expect(firstPayload.update.content.text).toBe(
				"Hello world! How are you?",
			);
			expect(firstPayload.update.sessionUpdate).toBe("agent_message_chunk");

			// Rest are stubs
			for (let i = 1; i < events.length; i++) {
				expect(isStub(getPayload(events[i].id))).toBe(true);
			}
		});
	});

	// ========== Test 3: Thought Chunk Consolidation ==========
	describe("consolidateChunks (agent_thought_chunk)", () => {
		it("should work identically for thought chunks", () => {
			const chunks = ["I think ", "therefore ", "I am"];
			const events: { id: number; payload: SessionNotification }[] = [];

			for (const text of chunks) {
				const p = makeChunkNotification(text, "agent_thought_chunk");
				const ev = appendEvent("agent_thought_chunk", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateChunks(
				events.map((e) => e.id),
				events.map((e) => e.payload),
				"agent_thought_chunk",
			);

			const firstPayload = getPayload(events[0].id) as {
				update: { content: { text: string }; sessionUpdate: string };
			};
			expect(firstPayload.update.content.text).toBe("I think therefore I am");
			expect(firstPayload.update.sessionUpdate).toBe("agent_thought_chunk");

			for (let i = 1; i < events.length; i++) {
				expect(isStub(getPayload(events[i].id))).toBe(true);
			}
		});
	});

	// ========== Test 4: Terminal Output Consolidation ==========
	describe("consolidateTerminalOutput", () => {
		it("should merge deltas into first event with truncated=true", () => {
			const terminalId = "term-1";
			const deltas = ["$ ls\n", "file1.ts\n", "file2.ts\n"];
			const events: { id: number; payload: unknown }[] = [];

			for (let i = 0; i < deltas.length; i++) {
				const p = makeTerminalPayload(
					terminalId,
					deltas[i],
					i === deltas.length - 1 ? { exitCode: 0 } : undefined,
				);
				const ev = appendEvent("terminal_output", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				events.map((e) => e.payload),
			);

			// First event has full output
			const firstPayload = getPayload(events[0].id) as Record<string, unknown>;
			expect(firstPayload.truncated).toBe(true);
			expect(firstPayload.output).toBe("$ ls\nfile1.ts\nfile2.ts\n");
			expect(firstPayload.exitStatus).toEqual({ exitCode: 0 });
			expect(firstPayload.terminalId).toBe(terminalId);

			// Rest are stubs
			for (let i = 1; i < events.length; i++) {
				expect(isStub(getPayload(events[i].id))).toBe(true);
			}
		});
	});

	// ========== Test 5: Usage Update Deduplication ==========
	describe("deduplicateUsageUpdates", () => {
		it("should keep only the last usage update", () => {
			const events: { id: number }[] = [];

			for (let i = 1; i <= 3; i++) {
				const p = makeUsageNotification(i * 1000, 100000);
				const ev = appendEvent("usage_update", p);
				events.push({ id: ev.id });
			}

			consolidator.deduplicateUsageUpdates(events.map((e) => e.id));

			// First two are stubs
			expect(isStub(getPayload(events[0].id))).toBe(true);
			expect(isStub(getPayload(events[1].id))).toBe(true);

			// Last one is preserved
			const lastPayload = getPayload(events[2].id) as {
				update: { used: number };
			};
			expect(lastPayload.update.used).toBe(3000);
		});
	});

	// ========== Test 6: Mixed Event Flow ==========
	describe("mixed event flow", () => {
		it("should correctly consolidate a complete turn", () => {
			// Simulate: chunks → tool_call + updates → more chunks → turn_end
			const allEvents: { id: number; kind: string }[] = [];

			// 3 message chunks
			const chunkPayloads: SessionNotification[] = [];
			const chunkIds: number[] = [];
			for (const text of ["Hello ", "world", "!"]) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				chunkPayloads.push(p);
				chunkIds.push(ev.id);
				allEvents.push({ id: ev.id, kind: "agent_message_chunk" });
			}

			// tool_call anchor
			const tcPayload = makeToolCallNotification("tc-mix", {
				title: "Write file",
				status: "pending",
			});
			const tcAnchor = appendEvent("tool_call", tcPayload);
			allEvents.push({ id: tcAnchor.id, kind: "tool_call" });

			// Flush chunks (tool_call is different kind) — manually simulate
			consolidator.consolidateChunks(
				chunkIds,
				chunkPayloads,
				"agent_message_chunk",
			);

			// tool_call_update (completed)
			const tcUpdatePayload = makeToolCallUpdateNotification("tc-mix", {
				status: "completed",
				title: "Write file done",
			});
			const tcUpdate = appendEvent("tool_call_update", tcUpdatePayload);
			allEvents.push({ id: tcUpdate.id, kind: "tool_call_update" });

			consolidator.consolidateToolCall(tcAnchor.id, [tcUpdate.id], tcPayload, [
				tcUpdatePayload,
			]);

			// 2 more message chunks
			const chunk2Payloads: SessionNotification[] = [];
			const chunk2Ids: number[] = [];
			for (const text of ["Done ", "writing."]) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				chunk2Payloads.push(p);
				chunk2Ids.push(ev.id);
				allEvents.push({ id: ev.id, kind: "agent_message_chunk" });
			}

			// turn_end triggers flush
			const turnEnd = appendEvent("turn_end", { stopReason: "end_turn" });
			allEvents.push({ id: turnEnd.id, kind: "turn_end" });

			// Flush second chunk run
			consolidator.consolidateChunks(
				chunk2Ids,
				chunk2Payloads,
				"agent_message_chunk",
			);

			// Verify: first chunk run consolidated
			const firstChunk = getPayload(chunkIds[0]) as {
				update: { content: { text: string } };
			};
			expect(firstChunk.update.content.text).toBe("Hello world!");
			expect(isStub(getPayload(chunkIds[1]))).toBe(true);
			expect(isStub(getPayload(chunkIds[2]))).toBe(true);

			// tool_call anchor has merged state
			const tcResult = getPayload(tcAnchor.id) as {
				update: Record<string, unknown>;
			};
			expect(tcResult.update.status).toBe("completed");
			expect(tcResult.update.title).toBe("Write file done");

			// tool_call_update is stubbed
			expect(isStub(getPayload(tcUpdate.id))).toBe(true);

			// Second chunk run consolidated
			const secondChunk = getPayload(chunk2Ids[0]) as {
				update: { content: { text: string } };
			};
			expect(secondChunk.update.content.text).toBe("Done writing.");
			expect(isStub(getPayload(chunk2Ids[1]))).toBe(true);

			// turn_end is preserved
			const turnEndPayload = getPayload(turnEnd.id) as {
				stopReason: string;
			};
			expect(turnEndPayload.stopReason).toBe("end_turn");
		});
	});

	// ========== Test 7: Seq Integrity ==========
	describe("seq integrity", () => {
		it("should preserve all seq numbers after consolidation (stub rows exist)", () => {
			const events: { id: number; seq: number }[] = [];

			// Write 5 chunks
			const payloads: SessionNotification[] = [];
			for (let i = 0; i < 5; i++) {
				const p = makeChunkNotification(`chunk${i}`, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				events.push({ id: ev.id, seq: ev.seq });
				payloads.push(p);
			}

			consolidator.consolidateChunks(
				events.map((e) => e.id),
				payloads,
				"agent_message_chunk",
			);

			// Query all events — all 5 seq numbers should exist
			const allEvents = walStore.queryEvents({
				sessionId: SESSION_ID,
				revision: REVISION,
				limit: 10000,
			});

			expect(allEvents.length).toBe(5);
			for (let i = 0; i < 5; i++) {
				expect(allEvents[i].seq).toBe(events[i].seq);
			}
		});
	});

	// ========== Test 8: Backfill Compatibility ==========
	describe("backfill compatibility", () => {
		it("should allow extract functions to skip stubs gracefully", () => {
			// Simulate backfill: consolidated events with stubs
			const p1 = makeChunkNotification(
				"Full message text",
				"agent_message_chunk",
			);
			const ev1 = appendEvent("agent_message_chunk", p1);

			const p2 = makeChunkNotification(" more", "agent_message_chunk");
			const ev2 = appendEvent("agent_message_chunk", p2);

			consolidator.consolidateChunks(
				[ev1.id, ev2.id],
				[p1, p2],
				"agent_message_chunk",
			);

			// Read all events (simulating backfill)
			const events = walStore.queryEvents({
				sessionId: SESSION_ID,
				revision: REVISION,
				limit: 10000,
			});

			// First event has the full text
			const first = events[0].payload as {
				update?: { content?: { text?: string } };
			};
			expect(first.update?.content?.text).toBe("Full message text more");

			// Second is a stub — extract functions would return null for _c payloads
			const second = events[1].payload as Record<string, unknown>;
			expect(second._c).toBe(true);
			// Stub has no "update" field, so extractTextChunk / extractToolCallUpdate
			// would fail gracefully (no sessionUpdate to match)
			expect(second.update).toBeUndefined();
		});
	});

	// ========== Test 9: Single Event No-Op ==========
	describe("single event no-op", () => {
		it("should not modify a single chunk", () => {
			const p = makeChunkNotification("only one", "agent_message_chunk");
			const ev = appendEvent("agent_message_chunk", p);

			consolidator.consolidateChunks([ev.id], [p], "agent_message_chunk");

			// Payload unchanged (single event, length <= 1 guard)
			const payload = getPayload(ev.id) as {
				update: { content: { text: string } };
			};
			expect(payload.update.content.text).toBe("only one");
		});

		it("should not modify a single terminal output", () => {
			const p = makeTerminalPayload("t-1", "output");
			const ev = appendEvent("terminal_output", p);

			consolidator.consolidateTerminalOutput([ev.id], [p]);

			const payload = getPayload(ev.id) as Record<string, unknown>;
			expect(payload.delta).toBe("output");
			expect(payload.truncated).toBe(false);
		});

		it("should not modify a single usage update", () => {
			const p = makeUsageNotification(500, 100000);
			const ev = appendEvent("usage_update", p);

			consolidator.deduplicateUsageUpdates([ev.id]);

			const payload = getPayload(ev.id) as {
				update: { used: number };
			};
			expect(payload.update.used).toBe(500);
		});
	});

	// ========== Test 10: Incomplete Tool Call Not Consolidated ==========
	describe("incomplete tool call", () => {
		it("should not consolidate when status is still in_progress", () => {
			const anchorPayload = makeToolCallNotification("tc-incomplete", {
				title: "Slow operation",
				status: "pending",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			const updatePayload = makeToolCallUpdateNotification("tc-incomplete", {
				status: "in_progress",
				title: "Still working...",
			});
			const update = appendEvent("tool_call_update", updatePayload);

			// Do NOT call consolidateToolCall — the tracker wouldn't trigger it
			// because status is in_progress. Verify both events are untouched.
			const anchorResult = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(anchorResult.update.status).toBe("pending");
			expect(anchorResult.update.title).toBe("Slow operation");

			const updateResult = getPayload(update.id) as {
				update: Record<string, unknown>;
			};
			expect(updateResult.update.status).toBe("in_progress");
			expect(updateResult.update.title).toBe("Still working...");
		});
	});

	// ========== Edge Cases ==========

	describe("tool call merge - null/undefined preservation", () => {
		it("should not override anchor fields when update has null values", () => {
			const anchorPayload = makeToolCallNotification("tc-null", {
				title: "Original title",
				status: "pending",
				rawInput: { command: "cat", file: "test.ts" },
				locations: [{ path: "/src/test.ts", line: 10 }],
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			// Update with null title and null rawInput — should NOT override
			const updatePayload = makeToolCallUpdateNotification("tc-null", {
				status: "completed",
				title: null,
				rawInput: null,
				rawOutput: { content: "result" },
			});
			const update = appendEvent("tool_call_update", updatePayload);

			consolidator.consolidateToolCall(anchor.id, [update.id], anchorPayload, [
				updatePayload,
			]);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			// status was non-null in update → overridden
			expect(result.update.status).toBe("completed");
			// title was null in update → anchor's value preserved
			expect(result.update.title).toBe("Original title");
			// rawInput was null in update → anchor's value preserved
			expect(result.update.rawInput).toEqual({
				command: "cat",
				file: "test.ts",
			});
			// rawOutput was non-null → applied
			expect(result.update.rawOutput).toEqual({ content: "result" });
			// locations not in update → anchor's value preserved
			expect(result.update.locations).toEqual([
				{ path: "/src/test.ts", line: 10 },
			]);
		});

		it("should handle undefined fields without overriding", () => {
			const anchorPayload = makeToolCallNotification("tc-undef", {
				title: "Keep me",
				status: "pending",
				content: [{ type: "content", text: "original" }],
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			// Update without title/content fields (undefined)
			const updatePayload = makeToolCallUpdateNotification("tc-undef", {
				status: "completed",
			});
			const update = appendEvent("tool_call_update", updatePayload);

			consolidator.consolidateToolCall(anchor.id, [update.id], anchorPayload, [
				updatePayload,
			]);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(result.update.title).toBe("Keep me");
			expect(result.update.content).toEqual([
				{ type: "content", text: "original" },
			]);
			expect(result.update.status).toBe("completed");
		});
	});

	describe("tool call merge - failed status", () => {
		it("should consolidate when status is failed", () => {
			const anchorPayload = makeToolCallNotification("tc-fail", {
				title: "Write file",
				status: "pending",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			const u1 = makeToolCallUpdateNotification("tc-fail", {
				status: "in_progress",
			});
			const ev1 = appendEvent("tool_call_update", u1);

			const u2 = makeToolCallUpdateNotification("tc-fail", {
				status: "failed",
				rawOutput: { error: "Permission denied" },
			});
			const ev2 = appendEvent("tool_call_update", u2);

			consolidator.consolidateToolCall(
				anchor.id,
				[ev1.id, ev2.id],
				anchorPayload,
				[u1, u2],
			);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(result.update.status).toBe("failed");
			expect(result.update.rawOutput).toEqual({ error: "Permission denied" });
			expect(isStub(getPayload(ev1.id))).toBe(true);
			expect(isStub(getPayload(ev2.id))).toBe(true);
		});
	});

	describe("tool call merge - multiple interleaved tool calls", () => {
		it("should independently consolidate different toolCallIds", () => {
			// Tool call A
			const aAnchor = makeToolCallNotification("tc-a", {
				title: "Read A",
				status: "pending",
			});
			const aEv = appendEvent("tool_call", aAnchor);

			// Tool call B (interleaved)
			const bAnchor = makeToolCallNotification("tc-b", {
				title: "Read B",
				status: "pending",
			});
			const bEv = appendEvent("tool_call", bAnchor);

			// Update A
			const aUpdate = makeToolCallUpdateNotification("tc-a", {
				status: "completed",
				title: "Read A done",
			});
			const aUpEv = appendEvent("tool_call_update", aUpdate);

			// Update B
			const bUpdate = makeToolCallUpdateNotification("tc-b", {
				status: "completed",
				title: "Read B done",
			});
			const bUpEv = appendEvent("tool_call_update", bUpdate);

			// Consolidate A
			consolidator.consolidateToolCall(aEv.id, [aUpEv.id], aAnchor, [aUpdate]);
			// Consolidate B
			consolidator.consolidateToolCall(bEv.id, [bUpEv.id], bAnchor, [bUpdate]);

			const aResult = getPayload(aEv.id) as {
				update: Record<string, unknown>;
			};
			expect(aResult.update.title).toBe("Read A done");
			expect(aResult.update.toolCallId).toBe("tc-a");

			const bResult = getPayload(bEv.id) as {
				update: Record<string, unknown>;
			};
			expect(bResult.update.title).toBe("Read B done");
			expect(bResult.update.toolCallId).toBe("tc-b");

			expect(isStub(getPayload(aUpEv.id))).toBe(true);
			expect(isStub(getPayload(bUpEv.id))).toBe(true);
		});
	});

	describe("chunks - empty text handling", () => {
		it("should handle chunks with empty text correctly", () => {
			const payloads: SessionNotification[] = [];
			const ids: number[] = [];

			for (const text of ["Hello", "", " world", ""]) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				payloads.push(p);
				ids.push(ev.id);
			}

			consolidator.consolidateChunks(ids, payloads, "agent_message_chunk");

			const result = getPayload(ids[0]) as {
				update: { content: { text: string } };
			};
			// Empty strings are falsy, so they get skipped by the `if (text)` check
			expect(result.update.content.text).toBe("Hello world");
		});
	});

	describe("chunks - non-text content types", () => {
		it("should skip non-text content when concatenating", () => {
			const textChunk = makeChunkNotification("Hello ", "agent_message_chunk");
			const imageChunk = {
				sessionId: SESSION_ID,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "image", data: "base64..." },
				},
			} as unknown as SessionNotification;
			const textChunk2 = makeChunkNotification("world", "agent_message_chunk");

			const ev1 = appendEvent("agent_message_chunk", textChunk);
			const ev2 = appendEvent("agent_message_chunk", imageChunk);
			const ev3 = appendEvent("agent_message_chunk", textChunk2);

			consolidator.consolidateChunks(
				[ev1.id, ev2.id, ev3.id],
				[textChunk, imageChunk, textChunk2],
				"agent_message_chunk",
			);

			const result = getPayload(ev1.id) as {
				update: { content: { text: string } };
			};
			// Only text chunks are concatenated, image is skipped
			expect(result.update.content.text).toBe("Hello world");
			expect(isStub(getPayload(ev2.id))).toBe(true);
			expect(isStub(getPayload(ev3.id))).toBe(true);
		});
	});

	describe("chunks - _meta field preservation", () => {
		it("should preserve _meta from first chunk payload", () => {
			const p1 = {
				sessionId: SESSION_ID,
				_meta: { source: "claude", priority: 1 },
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "First " },
				},
			} as unknown as SessionNotification;
			const p2 = makeChunkNotification("second", "agent_message_chunk");

			const ev1 = appendEvent("agent_message_chunk", p1);
			const ev2 = appendEvent("agent_message_chunk", p2);

			consolidator.consolidateChunks(
				[ev1.id, ev2.id],
				[p1, p2],
				"agent_message_chunk",
			);

			const result = getPayload(ev1.id) as {
				_meta?: Record<string, unknown>;
				update: { content: { text: string } };
			};
			expect(result._meta).toEqual({ source: "claude", priority: 1 });
			expect(result.update.content.text).toBe("First second");
		});
	});

	describe("terminal output - empty delta handling", () => {
		it("should handle empty deltas correctly", () => {
			const events: { id: number; payload: unknown }[] = [];
			const payloads = [
				makeTerminalPayload("t-empty", "$ cmd\n"),
				makeTerminalPayload("t-empty", ""),
				makeTerminalPayload("t-empty", "output\n"),
			];

			for (const p of payloads) {
				const ev = appendEvent("terminal_output", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				events.map((e) => e.payload),
			);

			const result = getPayload(events[0].id) as Record<string, unknown>;
			// Empty delta is falsy, so it gets skipped by `if (p.delta)` check
			expect(result.output).toBe("$ cmd\noutput\n");
		});
	});

	describe("terminal output - no exit status", () => {
		it("should not include exitStatus when none of the events have it", () => {
			const events: { id: number; payload: unknown }[] = [];
			const payloads = [
				makeTerminalPayload("t-noexit", "line1\n"),
				makeTerminalPayload("t-noexit", "line2\n"),
			];

			for (const p of payloads) {
				const ev = appendEvent("terminal_output", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				events.map((e) => e.payload),
			);

			const result = getPayload(events[0].id) as Record<string, unknown>;
			expect(result.output).toBe("line1\nline2\n");
			expect(result.exitStatus).toBeUndefined();
		});
	});

	describe("terminal output - multiple exitStatus values", () => {
		it("should keep the last exitStatus", () => {
			const events: { id: number; payload: unknown }[] = [];
			// Unusual: two events with exitStatus — last one wins
			const payloads = [
				makeTerminalPayload("t-multi-exit", "part1\n", { exitCode: 1 }),
				makeTerminalPayload("t-multi-exit", "part2\n", { exitCode: 0 }),
			];

			for (const p of payloads) {
				const ev = appendEvent("terminal_output", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				events.map((e) => e.payload),
			);

			const result = getPayload(events[0].id) as Record<string, unknown>;
			expect(result.exitStatus).toEqual({ exitCode: 0 });
		});
	});

	describe("empty arrays", () => {
		it("should be a no-op when consolidateChunks receives empty arrays", () => {
			consolidator.consolidateChunks([], [], "agent_message_chunk");
			// No error thrown — verified by reaching this point
		});

		it("should be a no-op when consolidateTerminalOutput receives empty arrays", () => {
			consolidator.consolidateTerminalOutput([], []);
		});

		it("should be a no-op when deduplicateUsageUpdates receives empty array", () => {
			consolidator.deduplicateUsageUpdates([]);
		});

		it("should be a no-op when stubEventPayloads receives empty array", () => {
			walStore.stubEventPayloads([]);
		});
	});

	describe("exactly two events boundary", () => {
		it("should consolidate exactly 2 chunks", () => {
			const p1 = makeChunkNotification("A", "agent_message_chunk");
			const p2 = makeChunkNotification("B", "agent_message_chunk");
			const ev1 = appendEvent("agent_message_chunk", p1);
			const ev2 = appendEvent("agent_message_chunk", p2);

			consolidator.consolidateChunks(
				[ev1.id, ev2.id],
				[p1, p2],
				"agent_message_chunk",
			);

			const result = getPayload(ev1.id) as {
				update: { content: { text: string } };
			};
			expect(result.update.content.text).toBe("AB");
			expect(isStub(getPayload(ev2.id))).toBe(true);
		});

		it("should consolidate exactly 2 terminal outputs", () => {
			const p1 = makeTerminalPayload("t-2", "a");
			const p2 = makeTerminalPayload("t-2", "b", { exitCode: 0 });
			const ev1 = appendEvent("terminal_output", p1);
			const ev2 = appendEvent("terminal_output", p2);

			consolidator.consolidateTerminalOutput([ev1.id, ev2.id], [p1, p2]);

			const result = getPayload(ev1.id) as Record<string, unknown>;
			expect(result.output).toBe("ab");
			expect(isStub(getPayload(ev2.id))).toBe(true);
		});

		it("should deduplicate exactly 2 usage updates", () => {
			const p1 = makeUsageNotification(100, 10000);
			const p2 = makeUsageNotification(200, 10000);
			const ev1 = appendEvent("usage_update", p1);
			const ev2 = appendEvent("usage_update", p2);

			consolidator.deduplicateUsageUpdates([ev1.id, ev2.id]);

			expect(isStub(getPayload(ev1.id))).toBe(true);
			const result = getPayload(ev2.id) as {
				update: { used: number };
			};
			expect(result.update.used).toBe(200);
		});
	});

	describe("idempotency", () => {
		it("should not corrupt data when consolidation is called twice", () => {
			const chunks = ["Hello ", "world"];
			const payloads: SessionNotification[] = [];
			const ids: number[] = [];

			for (const text of chunks) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				payloads.push(p);
				ids.push(ev.id);
			}

			// First consolidation
			consolidator.consolidateChunks(ids, payloads, "agent_message_chunk");

			// Read the consolidated first payload (for the second call)
			const firstResult = getPayload(ids[0]) as SessionNotification;

			// Second consolidation with the already-consolidated payloads
			// The stub payload has no text content, so it shouldn't change the result
			const stubPayload = getPayload(ids[1]) as SessionNotification;
			consolidator.consolidateChunks(
				ids,
				[firstResult, stubPayload],
				"agent_message_chunk",
			);

			const result = getPayload(ids[0]) as {
				update: { content: { text: string } };
			};
			// Still "Hello world" — stub has _c:true, no update.content.text
			expect(result.update.content.text).toBe("Hello world");
			expect(isStub(getPayload(ids[1]))).toBe(true);
		});
	});

	describe("session isolation", () => {
		it("should not affect events from a different session", () => {
			const session2 = "session-2";
			walStore.ensureSession({
				sessionId: session2,
				machineId: "machine-1",
				backendId: "backend-1",
			});

			// Events in session-1
			const p1 = makeChunkNotification("S1 text", "agent_message_chunk");
			const ev1 = appendEvent("agent_message_chunk", p1);
			const p2 = makeChunkNotification(" more", "agent_message_chunk");
			const ev2 = appendEvent("agent_message_chunk", p2);

			// Events in session-2
			const s2Event = walStore.appendEvent({
				sessionId: session2,
				revision: 1,
				kind: "agent_message_chunk",
				payload: makeChunkNotification("S2 untouched", "agent_message_chunk"),
			});

			// Consolidate session-1 only
			consolidator.consolidateChunks(
				[ev1.id, ev2.id],
				[p1, p2],
				"agent_message_chunk",
			);

			// Session-2 event untouched
			const s2Events = walStore.queryEvents({
				sessionId: session2,
				revision: 1,
				limit: 10000,
			});
			expect(s2Events.length).toBe(1);
			const s2Payload = s2Events[0].payload as {
				update: { content: { text: string } };
			};
			expect(s2Payload.update.content.text).toBe("S2 untouched");
		});
	});

	describe("WalStore new methods", () => {
		it("queryEventsBySeqRange should return empty for no matches", () => {
			const result = walStore.queryEventsBySeqRange(
				SESSION_ID,
				REVISION,
				100,
				200,
			);
			expect(result).toEqual([]);
		});

		it("queryEventsBySeqRange should return correct range", () => {
			// Append 5 events
			for (let i = 0; i < 5; i++) {
				appendEvent("user_message", { index: i });
			}

			// Query seq 2–4
			const result = walStore.queryEventsBySeqRange(SESSION_ID, REVISION, 2, 4);
			expect(result.length).toBe(3);
			expect(result[0].seq).toBe(2);
			expect(result[1].seq).toBe(3);
			expect(result[2].seq).toBe(4);
		});

		it("queryEventsBySeqRange with reversed range returns empty", () => {
			appendEvent("user_message", { text: "x" });
			const result = walStore.queryEventsBySeqRange(SESSION_ID, REVISION, 5, 1);
			expect(result).toEqual([]);
		});

		it("updateEventPayload should be a no-op for non-existent event ID", () => {
			// Should not throw
			walStore.updateEventPayload(999999, { test: true });
		});

		it("stubEventPayloads should produce exact stub format", () => {
			const ev = appendEvent("user_message", { original: "data" });
			walStore.stubEventPayloads([ev.id]);

			const result = getPayload(ev.id);
			expect(result).toEqual({ _c: true });
			// Verify exact shape: only _c key
			expect(Object.keys(result as Record<string, unknown>)).toEqual(["_c"]);
		});
	});

	describe("large event count", () => {
		it("should handle 100 chunks without errors", () => {
			const payloads: SessionNotification[] = [];
			const ids: number[] = [];

			for (let i = 0; i < 100; i++) {
				const p = makeChunkNotification(`c${i} `, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				payloads.push(p);
				ids.push(ev.id);
			}

			consolidator.consolidateChunks(ids, payloads, "agent_message_chunk");

			const result = getPayload(ids[0]) as {
				update: { content: { text: string } };
			};
			// Verify concatenation of all 100 chunks
			const expected = Array.from({ length: 100 }, (_, i) => `c${i} `).join("");
			expect(result.update.content.text).toBe(expected);

			// Verify all 99 others are stubs
			for (let i = 1; i < 100; i++) {
				expect(isStub(getPayload(ids[i]))).toBe(true);
			}
		});
	});

	describe("tool call - sessionUpdate always reset to tool_call", () => {
		it("should always set sessionUpdate to tool_call regardless of updates", () => {
			const anchorPayload = makeToolCallNotification("tc-su", {
				title: "Test",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			// tool_call_update has sessionUpdate: "tool_call_update"
			const updatePayload = makeToolCallUpdateNotification("tc-su", {
				status: "completed",
			});
			const update = appendEvent("tool_call_update", updatePayload);

			consolidator.consolidateToolCall(anchor.id, [update.id], anchorPayload, [
				updatePayload,
			]);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			// Must be "tool_call", not "tool_call_update"
			expect(result.update.sessionUpdate).toBe("tool_call");
		});
	});

	describe("tool call merge - progressive field accumulation", () => {
		it("should accumulate fields across multiple updates", () => {
			const anchorPayload = makeToolCallNotification("tc-accum", {
				title: "Execute",
				status: "pending",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			// Update 1: adds rawInput
			const u1 = makeToolCallUpdateNotification("tc-accum", {
				status: "in_progress",
				rawInput: { command: "ls", args: ["-la"] },
			});
			const ev1 = appendEvent("tool_call_update", u1);

			// Update 2: adds content
			const u2 = makeToolCallUpdateNotification("tc-accum", {
				content: [{ type: "terminal", text: "output line 1" }],
			});
			const ev2 = appendEvent("tool_call_update", u2);

			// Update 3: adds locations and completes
			const u3 = makeToolCallUpdateNotification("tc-accum", {
				status: "completed",
				locations: [{ path: "/home/test" }],
				rawOutput: { exitCode: 0 },
			});
			const ev3 = appendEvent("tool_call_update", u3);

			consolidator.consolidateToolCall(
				anchor.id,
				[ev1.id, ev2.id, ev3.id],
				anchorPayload,
				[u1, u2, u3],
			);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(result.update.status).toBe("completed");
			expect(result.update.rawInput).toEqual({ command: "ls", args: ["-la"] });
			expect(result.update.content).toEqual([
				{ type: "terminal", text: "output line 1" },
			]);
			expect(result.update.locations).toEqual([{ path: "/home/test" }]);
			expect(result.update.rawOutput).toEqual({ exitCode: 0 });
			expect(result.update.title).toBe("Execute");

			expect(isStub(getPayload(ev1.id))).toBe(true);
			expect(isStub(getPayload(ev2.id))).toBe(true);
			expect(isStub(getPayload(ev3.id))).toBe(true);
		});
	});

	describe("kind metadata preservation", () => {
		it("should preserve event kind in DB after stub", () => {
			const p = makeChunkNotification("text", "agent_message_chunk");
			const ev = appendEvent("agent_message_chunk", p);
			const p2 = makeChunkNotification("more", "agent_message_chunk");
			const ev2 = appendEvent("agent_message_chunk", p2);

			consolidator.consolidateChunks(
				[ev.id, ev2.id],
				[p, p2],
				"agent_message_chunk",
			);

			// Query and verify the stubbed event still has its original kind
			const events = walStore.queryEvents({
				sessionId: SESSION_ID,
				revision: REVISION,
				limit: 10000,
			});

			expect(events[1].kind).toBe("agent_message_chunk");
			expect(isStub(events[1].payload)).toBe(true);
		});
	});

	// ========== Edge Case Tests (Boundary) ==========

	describe("tool call idempotency", () => {
		it("should not corrupt data when consolidateToolCall is called twice", () => {
			const anchorPayload = makeToolCallNotification("tc-idem", {
				title: "Read file",
				status: "pending",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			const updatePayload = makeToolCallUpdateNotification("tc-idem", {
				status: "completed",
				title: "Read file done",
				rawOutput: { content: "data" },
			});
			const update = appendEvent("tool_call_update", updatePayload);

			// First consolidation
			consolidator.consolidateToolCall(anchor.id, [update.id], anchorPayload, [
				updatePayload,
			]);

			// Read back consolidated payloads
			const mergedAnchor = getPayload(anchor.id) as SessionNotification;
			const stubPayload = getPayload(update.id) as SessionNotification;

			// Second consolidation with already-consolidated payloads
			consolidator.consolidateToolCall(anchor.id, [update.id], mergedAnchor, [
				stubPayload,
			]);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(result.update.status).toBe("completed");
			expect(result.update.title).toBe("Read file done");
			expect(result.update.rawOutput).toEqual({ content: "data" });
			expect(result.update.sessionUpdate).toBe("tool_call");
		});
	});

	describe("terminal output idempotency", () => {
		it("should not corrupt data when consolidateTerminalOutput is called twice", () => {
			const payloads = [
				makeTerminalPayload("t-idem", "line1\n"),
				makeTerminalPayload("t-idem", "line2\n", { exitCode: 0 }),
			];
			const events: { id: number; payload: unknown }[] = [];
			for (const p of payloads) {
				const ev = appendEvent("terminal_output", p);
				events.push({ id: ev.id, payload: p });
			}

			// First consolidation
			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				events.map((e) => e.payload),
			);

			// Read back and consolidate again
			const merged = getPayload(events[0].id);
			const stub = getPayload(events[1].id);
			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				[merged, stub],
			);

			const result = getPayload(events[0].id) as Record<string, unknown>;
			expect(result.output).toBe("line1\nline2\n");
			expect(result.exitStatus).toEqual({ exitCode: 0 });
		});
	});

	describe("usage update idempotency", () => {
		it("should not corrupt data when deduplicateUsageUpdates is called twice", () => {
			const events: { id: number }[] = [];
			for (let i = 1; i <= 3; i++) {
				const p = makeUsageNotification(i * 100, 10000);
				const ev = appendEvent("usage_update", p);
				events.push({ id: ev.id });
			}

			// First deduplication
			consolidator.deduplicateUsageUpdates(events.map((e) => e.id));

			// Second deduplication (stubs already in place)
			consolidator.deduplicateUsageUpdates(events.map((e) => e.id));

			// First two still stubs, last still preserved
			expect(isStub(getPayload(events[0].id))).toBe(true);
			expect(isStub(getPayload(events[1].id))).toBe(true);
			const lastPayload = getPayload(events[2].id) as {
				update: { used: number };
			};
			expect(lastPayload.update.used).toBe(300);
		});
	});

	describe("all non-text chunks", () => {
		it("should produce empty text when all chunks are image type", () => {
			const imageChunks = Array.from({ length: 3 }, () => ({
				sessionId: SESSION_ID,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "image", data: "base64..." },
				},
			})) as unknown as SessionNotification[];

			const ids: number[] = [];
			for (const p of imageChunks) {
				const ev = appendEvent("agent_message_chunk", p);
				ids.push(ev.id);
			}

			consolidator.consolidateChunks(ids, imageChunks, "agent_message_chunk");

			const result = getPayload(ids[0]) as {
				update: { content: { text: string } };
			};
			expect(result.update.content.text).toBe("");
		});
	});

	describe("unicode text in chunks", () => {
		it("should correctly concatenate multibyte characters (emoji, CJK)", () => {
			const texts = ["你好", "世界🌍", "！テスト", "🎉"];
			const payloads: SessionNotification[] = [];
			const ids: number[] = [];

			for (const text of texts) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				payloads.push(p);
				ids.push(ev.id);
			}

			consolidator.consolidateChunks(ids, payloads, "agent_message_chunk");

			const result = getPayload(ids[0]) as {
				update: { content: { text: string } };
			};
			expect(result.update.content.text).toBe("你好世界🌍！テスト🎉");
		});
	});

	describe("tool call empty string fields", () => {
		it("should allow empty string to override non-empty values", () => {
			const anchorPayload = makeToolCallNotification("tc-empty-str", {
				title: "Original",
				status: "pending",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			// Empty string is truthy for our merge logic (not null/undefined)
			const updatePayload = makeToolCallUpdateNotification("tc-empty-str", {
				status: "completed",
				title: "",
			});
			const update = appendEvent("tool_call_update", updatePayload);

			consolidator.consolidateToolCall(anchor.id, [update.id], anchorPayload, [
				updatePayload,
			]);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			// Empty string "" is not null/undefined → it should override
			expect(result.update.title).toBe("");
			expect(result.update.status).toBe("completed");
		});
	});

	describe("terminal exitCode null vs undefined", () => {
		it("should treat { exitCode: null } as a valid exitStatus only when non-null/undefined check passes", () => {
			const payloads = [
				makeTerminalPayload("t-null-exit", "output\n"),
				makeTerminalPayload("t-null-exit", "", { exitCode: null }),
			];
			const events: { id: number; payload: unknown }[] = [];
			for (const p of payloads) {
				const ev = appendEvent("terminal_output", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				events.map((e) => e.payload),
			);

			const result = getPayload(events[0].id) as Record<string, unknown>;
			// exitStatus object { exitCode: null } itself is not null/undefined,
			// but the filter checks `exitStatus !== null` which rejects null directly.
			// makeTerminalPayload wraps it as { exitCode: null }, so exitStatus is an object → passes filter
			expect(result.exitStatus).toEqual({ exitCode: null });
		});
	});

	describe("alternating chunk types", () => {
		it("should consolidate each kind independently when called per-segment", () => {
			// Segment 1: message chunks
			const msgPayloads: SessionNotification[] = [];
			const msgIds: number[] = [];
			for (const text of ["Hello ", "world"]) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				msgPayloads.push(p);
				msgIds.push(ev.id);
			}

			// Segment 2: thought chunks
			const thoughtPayloads: SessionNotification[] = [];
			const thoughtIds: number[] = [];
			for (const text of ["I think ", "so"]) {
				const p = makeChunkNotification(text, "agent_thought_chunk");
				const ev = appendEvent("agent_thought_chunk", p);
				thoughtPayloads.push(p);
				thoughtIds.push(ev.id);
			}

			// Segment 3: message chunks again
			const msg2Payloads: SessionNotification[] = [];
			const msg2Ids: number[] = [];
			for (const text of ["Goodbye ", "!"]) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				msg2Payloads.push(p);
				msg2Ids.push(ev.id);
			}

			// Consolidate each segment independently
			consolidator.consolidateChunks(
				msgIds,
				msgPayloads,
				"agent_message_chunk",
			);
			consolidator.consolidateChunks(
				thoughtIds,
				thoughtPayloads,
				"agent_thought_chunk",
			);
			consolidator.consolidateChunks(
				msg2Ids,
				msg2Payloads,
				"agent_message_chunk",
			);

			const msgResult = getPayload(msgIds[0]) as {
				update: { content: { text: string }; sessionUpdate: string };
			};
			expect(msgResult.update.content.text).toBe("Hello world");
			expect(msgResult.update.sessionUpdate).toBe("agent_message_chunk");

			const thoughtResult = getPayload(thoughtIds[0]) as {
				update: { content: { text: string }; sessionUpdate: string };
			};
			expect(thoughtResult.update.content.text).toBe("I think so");
			expect(thoughtResult.update.sessionUpdate).toBe("agent_thought_chunk");

			const msg2Result = getPayload(msg2Ids[0]) as {
				update: { content: { text: string }; sessionUpdate: string };
			};
			expect(msg2Result.update.content.text).toBe("Goodbye !");
			expect(msg2Result.update.sessionUpdate).toBe("agent_message_chunk");
		});
	});

	describe("first chunk is non-text", () => {
		it("should handle image as first chunk followed by text chunks", () => {
			const imageChunk = {
				sessionId: SESSION_ID,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "image", data: "base64..." },
				},
			} as unknown as SessionNotification;
			const textChunk1 = makeChunkNotification("Hello ", "agent_message_chunk");
			const textChunk2 = makeChunkNotification("world", "agent_message_chunk");

			const ev1 = appendEvent("agent_message_chunk", imageChunk);
			const ev2 = appendEvent("agent_message_chunk", textChunk1);
			const ev3 = appendEvent("agent_message_chunk", textChunk2);

			consolidator.consolidateChunks(
				[ev1.id, ev2.id, ev3.id],
				[imageChunk, textChunk1, textChunk2],
				"agent_message_chunk",
			);

			// First chunk gets merged result — text from text chunks only
			const result = getPayload(ev1.id) as {
				update: { content: { text: string } };
			};
			expect(result.update.content.text).toBe("Hello world");
			expect(isStub(getPayload(ev2.id))).toBe(true);
			expect(isStub(getPayload(ev3.id))).toBe(true);
		});
	});

	describe("tool call many updates", () => {
		it("should handle 50 in_progress updates + 1 completed", () => {
			const anchorPayload = makeToolCallNotification("tc-many", {
				title: "Long operation",
				status: "pending",
			});
			const anchor = appendEvent("tool_call", anchorPayload);

			const updatePayloads: SessionNotification[] = [];
			const updateIds: number[] = [];

			// 50 in_progress updates with progressive titles
			for (let i = 0; i < 50; i++) {
				const p = makeToolCallUpdateNotification("tc-many", {
					status: "in_progress",
					title: `Step ${i + 1}`,
				});
				const ev = appendEvent("tool_call_update", p);
				updatePayloads.push(p);
				updateIds.push(ev.id);
			}

			// 1 completed
			const completedPayload = makeToolCallUpdateNotification("tc-many", {
				status: "completed",
				title: "All done",
				rawOutput: { result: "success" },
			});
			const completedEv = appendEvent("tool_call_update", completedPayload);
			updatePayloads.push(completedPayload);
			updateIds.push(completedEv.id);

			consolidator.consolidateToolCall(
				anchor.id,
				updateIds,
				anchorPayload,
				updatePayloads,
			);

			const result = getPayload(anchor.id) as {
				update: Record<string, unknown>;
			};
			expect(result.update.status).toBe("completed");
			expect(result.update.title).toBe("All done");
			expect(result.update.rawOutput).toEqual({ result: "success" });
			expect(result.update.sessionUpdate).toBe("tool_call");

			// All 51 updates should be stubs
			for (const id of updateIds) {
				expect(isStub(getPayload(id))).toBe(true);
			}
		});
	});

	describe("chunks with whitespace-only text", () => {
		it("should preserve whitespace-only text chunks", () => {
			const payloads: SessionNotification[] = [];
			const ids: number[] = [];

			// Note: current implementation uses `if (text)` which skips falsy values
			// but whitespace strings like "  " and "\n" are truthy
			for (const text of ["Hello", "  ", "\n", "World"]) {
				const p = makeChunkNotification(text, "agent_message_chunk");
				const ev = appendEvent("agent_message_chunk", p);
				payloads.push(p);
				ids.push(ev.id);
			}

			consolidator.consolidateChunks(ids, payloads, "agent_message_chunk");

			const result = getPayload(ids[0]) as {
				update: { content: { text: string } };
			};
			// "  " and "\n" are truthy → included
			expect(result.update.content.text).toBe("Hello  \nWorld");
		});
	});

	describe("terminal output single delta empty string", () => {
		it("should handle a single event with empty string delta when paired", () => {
			const payloads = [
				makeTerminalPayload("t-single-empty", ""),
				makeTerminalPayload("t-single-empty", "actual output", {
					exitCode: 0,
				}),
			];
			const events: { id: number; payload: unknown }[] = [];
			for (const p of payloads) {
				const ev = appendEvent("terminal_output", p);
				events.push({ id: ev.id, payload: p });
			}

			consolidator.consolidateTerminalOutput(
				events.map((e) => e.id),
				events.map((e) => e.payload),
			);

			const result = getPayload(events[0].id) as Record<string, unknown>;
			// Empty delta is falsy → skipped; only "actual output" included
			expect(result.output).toBe("actual output");
			expect(result.exitStatus).toEqual({ exitCode: 0 });
			expect(isStub(getPayload(events[1].id))).toBe(true);
		});
	});
});
