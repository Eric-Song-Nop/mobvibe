import { describe, expect, it } from "vitest";
import {
	hasCachedSessionHistory,
	shouldActivateSessionOnSelect,
	sidebarEntryContainsAvailableSession,
} from "@/lib/session-selection";

describe("session selection cache policy", () => {
	it("activates detached sessions without cached history", () => {
		expect(
			shouldActivateSessionOnSelect({
				isAttached: false,
				isLoading: false,
				messages: [],
				terminalOutputs: {},
			}),
		).toBe(true);
	});

	it("keeps detached sessions with cached messages on the local transcript", () => {
		expect(
			shouldActivateSessionOnSelect({
				isAttached: false,
				isLoading: false,
				messages: [
					{
						id: "msg-1",
						role: "assistant",
						kind: "text",
						content: "cached reply",
						contentBlocks: [],
						createdAt: "2024-01-01T00:00:00Z",
						isStreaming: false,
					},
				],
				terminalOutputs: {},
			}),
		).toBe(false);
	});

	it("treats persisted terminal output as cached history", () => {
		expect(
			hasCachedSessionHistory({
				messages: [],
				terminalOutputs: {
					"term-1": {
						terminalId: "term-1",
						output: "cached stdout",
						truncated: false,
					},
				},
			}),
		).toBe(true);
	});

	it("does not re-activate attached or loading sessions", () => {
		expect(
			shouldActivateSessionOnSelect({
				isAttached: true,
				isLoading: false,
				messages: [],
				terminalOutputs: {},
			}),
		).toBe(false);
		expect(
			shouldActivateSessionOnSelect({
				isAttached: false,
				isLoading: true,
				messages: [],
				terminalOutputs: {},
			}),
		).toBe(false);
	});

	it("drops a Team member session after its live projection disappears", () => {
		expect(
			sidebarEntryContainsAvailableSession(
				{
					kind: "agent-team",
					members: [
						{
							sessionId: "remote-session",
							session: undefined,
						},
					],
				},
				"remote-session",
			),
		).toBe(false);

		expect(
			sidebarEntryContainsAvailableSession(
				{
					kind: "agent-team",
					members: [
						{
							sessionId: "remote-session",
							session: { sessionId: "remote-session" },
						},
					],
				},
				"remote-session",
			),
		).toBe(true);
	});
});
