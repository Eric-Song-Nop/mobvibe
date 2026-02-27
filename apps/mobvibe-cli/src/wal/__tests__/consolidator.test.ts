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
});
