import { beforeEach, describe, expect, it } from "vitest";
import {
	createSessionSyncBackup,
	restoreBackupIfSessionWasReset,
} from "@/hooks/backfill-manager";
import { useChatStore } from "@/lib/chat-store";

const resetStore = () => {
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
		lastCreatedCwd: {},
	});
};

describe("backfill plan snapshot recovery", () => {
	beforeEach(resetStore);

	it("restores legacy and operation plans after a failed same-revision full sync", () => {
		const store = useChatStore.getState();
		store.createLocalSession("s1");
		store.updateSessionMeta("s1", {
			plan: [
				{
					content: "Legacy task",
					priority: "medium",
					status: "in_progress",
				},
			],
		});
		store.upsertPlan("s1", {
			type: "markdown",
			planId: "plan-a",
			content: "# Operation plan",
		});
		store.addUserMessage("s1", "preserve history");
		store.updateSessionCursor("s1", 4, 9);
		const backup = createSessionSyncBackup(useChatStore.getState().sessions.s1);

		store.resetSessionForRevision("s1", 4);
		expect(useChatStore.getState().sessions.s1).toEqual(
			expect.objectContaining({
				messages: [],
				plan: undefined,
				plans: undefined,
				lastAppliedSeq: 0,
			}),
		);

		restoreBackupIfSessionWasReset({
			store: useChatStore.getState(),
			sessionId: "s1",
			backup,
		});

		expect(useChatStore.getState().sessions.s1).toEqual(
			expect.objectContaining({
				messages: [expect.objectContaining({ content: "preserve history" })],
				plan: [
					{
						content: "Legacy task",
						priority: "medium",
						status: "in_progress",
					},
				],
				plans: [
					{
						type: "markdown",
						planId: "plan-a",
						content: "# Operation plan",
					},
				],
				revision: 4,
				lastAppliedSeq: 9,
			}),
		);
	});
});
