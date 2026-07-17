import { describe, expect, it } from "vitest";
import {
	ACP_PLAN_ENTRIES_MAX_BYTES,
	ACP_PLAN_ENTRY_MAX_BYTES,
	ACP_PLAN_ID_MAX_BYTES,
	ACP_PLAN_MARKDOWN_MAX_BYTES,
	ACP_PLAN_MAX_ENTRIES,
	ACP_PLAN_UPDATE_MAX_BYTES,
	ACP_PLAN_URI_MAX_BYTES,
	sanitizePlanOperationUpdate,
	sanitizePlanSessionUpdate,
} from "../src/plan-operations.js";

describe("sanitizePlanOperationUpdate", () => {
	it("bounds and normalizes the stable legacy plan independently", () => {
		expect(
			sanitizePlanSessionUpdate({
				sessionUpdate: "plan",
				entries: [
					{ content: "Legacy", priority: "medium", status: "completed" },
				],
				extra: "dropped",
			}),
		).toEqual({
			sessionUpdate: "plan",
			entries: [{ content: "Legacy", priority: "medium", status: "completed" }],
		});
		expect(
			sanitizePlanSessionUpdate({
				sessionUpdate: "plan",
				entries: [
					{
						content: "x".repeat(ACP_PLAN_ENTRY_MAX_BYTES + 1),
						priority: "medium",
						status: "pending",
					},
				],
			}),
		).toBeUndefined();
	});

	it("normalizes every SDK 1.2.1 planId variant and bounded metadata", () => {
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_update",
				plan: {
					type: "items",
					planId: "implementation",
					entries: [
						{ content: "Ship it", priority: "high", status: "in_progress" },
					],
					_meta: { source: "agent" },
					extra: "dropped",
				},
				_meta: { revision: 2 },
				extra: "dropped",
			}),
		).toEqual({
			sessionUpdate: "plan_update",
			plan: {
				type: "items",
				planId: "implementation",
				entries: [
					{ content: "Ship it", priority: "high", status: "in_progress" },
				],
				_meta: { source: "agent" },
			},
			_meta: { revision: 2 },
		});

		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_update",
				plan: { type: "markdown", planId: "design", content: "" },
			}),
		).toEqual({
			sessionUpdate: "plan_update",
			plan: { type: "markdown", planId: "design", content: "" },
		});
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_update",
				plan: { type: "file", planId: "source", uri: "file:///tmp/plan.md" },
			}),
		).toEqual({
			sessionUpdate: "plan_update",
			plan: { type: "file", planId: "source", uri: "file:///tmp/plan.md" },
		});
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_removed",
				planId: "implementation",
			}),
		).toEqual({
			sessionUpdate: "plan_removed",
			planId: "implementation",
		});
	});

	it("accepts empty item plans but rejects the Draft RFD's obsolete id spelling", () => {
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_update",
				plan: { type: "items", planId: "empty", entries: [] },
			}),
		).toEqual({
			sessionUpdate: "plan_update",
			plan: { type: "items", planId: "empty", entries: [] },
		});
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_update",
				plan: { type: "markdown", id: "old", content: "text" },
			}),
		).toBeUndefined();
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_removed",
				id: "old",
			}),
		).toBeUndefined();
	});

	it.each([
		"",
		" padded",
		"padded ",
		"bad\u0000id",
		"x".repeat(ACP_PLAN_ID_MAX_BYTES + 1),
	])("rejects unsafe plan IDs: %j", (planId) => {
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_removed",
				planId,
			}),
		).toBeUndefined();
	});

	it("enforces item count, per-entry, aggregate, and enum bounds", () => {
		const update = (entries: unknown[]) =>
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_update",
				plan: { type: "items", planId: "bounded", entries },
			});
		const validEntry = { content: "x", priority: "low", status: "pending" };

		expect(
			update(Array(ACP_PLAN_MAX_ENTRIES + 1).fill(validEntry)),
		).toBeUndefined();
		expect(
			update([
				{
					...validEntry,
					content: "x".repeat(ACP_PLAN_ENTRY_MAX_BYTES + 1),
				},
			]),
		).toBeUndefined();
		expect(
			update(
				Array(17).fill({
					...validEntry,
					content: "x".repeat(ACP_PLAN_ENTRY_MAX_BYTES),
				}),
			),
		).toBeUndefined();
		expect(17 * ACP_PLAN_ENTRY_MAX_BYTES).toBeGreaterThan(
			ACP_PLAN_ENTRIES_MAX_BYTES,
		);
		expect(update([{ ...validEntry, priority: "urgent" }])).toBeUndefined();
		expect(update([{ ...validEntry, status: "blocked" }])).toBeUndefined();
	});

	it("enforces markdown and nonempty inert URI bounds", () => {
		expect(
			sanitizePlanOperationUpdate({
				sessionUpdate: "plan_update",
				plan: {
					type: "markdown",
					planId: "large",
					content: "x".repeat(ACP_PLAN_MARKDOWN_MAX_BYTES + 1),
				},
			}),
		).toBeUndefined();
		for (const uri of [
			"",
			"file:///tmp/bad\nplan",
			"x".repeat(ACP_PLAN_URI_MAX_BYTES + 1),
		]) {
			expect(
				sanitizePlanOperationUpdate({
					sessionUpdate: "plan_update",
					plan: { type: "file", planId: "file", uri },
				}),
			).toBeUndefined();
		}
	});

	it("caps the complete sanitized projection including nested metadata", () => {
		const entries = Array.from(
			{ length: ACP_PLAN_MAX_ENTRIES },
			(_, index) => ({
				content: `entry-${index}`,
				priority: "low",
				status: "pending",
				_meta: { note: "x".repeat(4_000) },
			}),
		);
		expect(JSON.stringify(entries).length).toBeGreaterThan(
			ACP_PLAN_UPDATE_MAX_BYTES,
		);
		expect(
			sanitizePlanSessionUpdate({ sessionUpdate: "plan", entries }),
		).toBeUndefined();
	});
});
