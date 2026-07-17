import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applySessionEvent,
	type SessionEventNotifications,
	type SessionEventReducerActions,
} from "@/hooks/session-event-reducer";
import type { ContentBlock, SessionEvent } from "@/lib/acp";
import { useChatStore } from "@/lib/chat-store";

const createActions = (): SessionEventReducerActions => ({
	appendAssistantChunk: vi.fn(),
	appendThoughtChunk: vi.fn(),
	confirmOrAppendUserMessage: vi.fn(),
	updateSessionMeta: vi.fn(),
	setStreamError: vi.fn(),
	addPermissionRequest: vi.fn(),
	setPermissionDecisionState: vi.fn(),
	setPermissionOutcome: vi.fn(),
	addToolCall: vi.fn(),
	updateToolCall: vi.fn(),
	appendTerminalOutput: vi.fn(),
});

const notifications: SessionEventNotifications = {
	notifyPermissionRequest: vi.fn(),
	notifyResponseCompleted: vi.fn(),
	notifySessionError: vi.fn(),
};

describe("applySessionEvent user message identity", () => {
	it("passes a persisted message id to provisional confirmation", () => {
		const actions = createActions();
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 1,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "user_message",
			payload: {
				sessionId: "session-1",
				messageId: "message-1",
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({
			event,
			sessions: {},
			actions,
			notifications,
		});

		expect(actions.confirmOrAppendUserMessage).toHaveBeenCalledWith(
			"session-1",
			{ type: "text", text: "Hello" },
			"message-1",
			1,
			undefined,
		);
	});

	it("passes image-only user chunks through to history reconstruction", () => {
		const actions = createActions();
		const image = {
			type: "image",
			data: "aW1hZ2U=",
			mimeType: "image/png",
		} satisfies ContentBlock;
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 2,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "user_message",
			payload: {
				sessionId: "session-1",
				messageId: "message-image",
				update: {
					sessionUpdate: "user_message_chunk",
					content: image,
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({
			event,
			sessions: {},
			actions,
			notifications,
		});

		expect(actions.confirmOrAppendUserMessage).toHaveBeenCalledWith(
			"session-1",
			image,
			"message-image",
			2,
			undefined,
		);
	});

	it("passes sequence identity for legacy chunks without a message id", () => {
		const actions = createActions();
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 7,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "user_message",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "legacy" },
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({
			event,
			sessions: {},
			actions,
			notifications,
		});

		expect(actions.confirmOrAppendUserMessage).toHaveBeenCalledWith(
			"session-1",
			{ type: "text", text: "legacy" },
			undefined,
			7,
			undefined,
		);
	});

	it("does not treat an ACP messageId as a send idempotency key", () => {
		const actions = createActions();
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 8,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "user_message",
			protocolMessageId: "acp-user-message-1",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "user_message_chunk",
					messageId: "acp-user-message-1",
					content: { type: "text", text: "protocol identity" },
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({
			event,
			sessions: {},
			actions,
			notifications,
		});

		expect(actions.confirmOrAppendUserMessage).toHaveBeenCalledWith(
			"session-1",
			{ type: "text", text: "protocol identity" },
			undefined,
			8,
			"acp-user-message-1",
		);
	});
});

describe("applySessionEvent ACP message boundaries", () => {
	it("passes the projected protocol messageId to assistant chunks", () => {
		const actions = createActions();
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 1,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "agent_message_chunk",
			protocolMessageId: "assistant-1",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					messageId: "assistant-1",
					content: { type: "text", text: "Hello" },
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({
			event,
			sessions: {},
			actions,
			notifications,
		});

		expect(actions.appendAssistantChunk).toHaveBeenCalledWith(
			"session-1",
			{ type: "text", text: "Hello" },
			"assistant-1",
		);
	});

	it("falls back to the native update field from older event transports", () => {
		const actions = createActions();
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 2,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "agent_message_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					messageId: "assistant-native",
					content: { type: "text", text: "there" },
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({
			event,
			sessions: {},
			actions,
			notifications,
		});

		expect(actions.appendAssistantChunk).toHaveBeenCalledWith(
			"session-1",
			{ type: "text", text: "there" },
			"assistant-native",
		);
	});

	it("projects real thought chunks with their protocol boundary", () => {
		const actions = createActions();
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 3,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "agent_thought_chunk",
			protocolMessageId: "thought-1",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_thought_chunk",
					messageId: "thought-1",
					content: { type: "text", text: "Reasoning" },
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({
			event,
			sessions: {},
			actions,
			notifications,
		});

		expect(actions.appendThoughtChunk).toHaveBeenCalledWith(
			"session-1",
			{ type: "text", text: "Reasoning" },
			"thought-1",
		);
	});

	it("preserves structured assistant content and block metadata", () => {
		const actions = createActions();
		const image = {
			type: "image",
			data: "aW1hZ2U=",
			mimeType: "image/png",
			annotations: { audience: ["user"], priority: 0.8 },
			_meta: { source: "agent" },
		} satisfies ContentBlock;
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 4,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "agent_message_chunk",
			protocolMessageId: "assistant-image",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					messageId: "assistant-image",
					content: image,
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({ event, sessions: {}, actions, notifications });

		expect(actions.appendAssistantChunk).toHaveBeenCalledWith(
			"session-1",
			image,
			"assistant-image",
		);
	});

	it("preserves embedded resources in thought chunks", () => {
		const actions = createActions();
		const resource = {
			type: "resource",
			resource: {
				uri: "file:///workspace/notes.txt",
				mimeType: "text/plain",
				text: "private reasoning context",
			},
		} satisfies ContentBlock;
		const event = {
			sessionId: "session-1",
			machineId: "machine-1",
			revision: 1,
			seq: 5,
			createdAt: "2026-07-16T00:00:00.000Z",
			kind: "agent_thought_chunk",
			payload: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: resource,
				},
			},
		} satisfies SessionEvent;

		applySessionEvent({ event, sessions: {}, actions, notifications });

		expect(actions.appendThoughtChunk).toHaveBeenCalledWith(
			"session-1",
			resource,
		);
	});
});

describe("applySessionEvent session info semantics", () => {
	const sessionId = "session-info-1";

	const resetSession = (isTitlePinned = false) => {
		useChatStore.setState({ sessions: {}, activeSessionId: undefined });
		const store = useChatStore.getState();
		store.createLocalSession(sessionId, {
			title: isTitlePinned ? "Pinned title" : "Initial title",
			updatedAt: "2026-07-10T00:00:00.000Z",
		});
		store.updateSessionMeta(sessionId, {
			_meta: { initial: true },
			isTitlePinned,
		});
	};

	const createSessionInfoEvent = (
		seq: number,
		createdAt: string,
		update: Record<string, unknown>,
	): SessionEvent =>
		({
			sessionId,
			machineId: "machine-1",
			revision: 1,
			seq,
			createdAt,
			kind: "session_info_update",
			payload: {
				sessionId,
				update: { sessionUpdate: "session_info_update", ...update },
			},
		}) as SessionEvent;

	const applyToStore = (event: SessionEvent) => {
		const store = useChatStore.getState();
		applySessionEvent({
			event,
			session: store.sessions[event.sessionId],
			sessions: store.sessions,
			actions: store,
			notifications,
		});
	};

	beforeEach(() => resetSession());

	it("replaces opaque metadata and produces identical live and replay state", () => {
		const events = [
			createSessionInfoEvent(1, "2026-07-11T00:00:00.000Z", {
				title: "Agent title",
				updatedAt: "2026-07-09T00:00:00.000Z",
				_meta: { stale: true, nested: { old: 1 } },
			}),
			createSessionInfoEvent(2, "2026-07-12T00:00:00.000Z", {
				_meta: {
					fresh: true,
					nested: { keep: null },
					preservedNull: null,
				},
			}),
			createSessionInfoEvent(3, "2026-07-13T00:00:00.000Z", {
				title: null,
				updatedAt: null,
			}),
			createSessionInfoEvent(4, "2026-07-14T00:00:00.000Z", {
				updatedAt: "not-a-timestamp",
				_meta: null,
			}),
		];

		for (const event of events.slice(0, 2)) applyToStore(event);
		expect(useChatStore.getState().sessions[sessionId]._meta).toEqual({
			fresh: true,
			nested: { keep: null },
			preservedNull: null,
		});
		for (const event of events.slice(2)) applyToStore(event);
		const live = useChatStore.getState().sessions[sessionId];
		expect(live).toEqual(
			expect.objectContaining({
				title: `Session ${sessionId.slice(0, 8)}`,
				updatedAt: "2026-07-14T00:00:00.000Z",
				_meta: null,
			}),
		);

		resetSession();
		for (const event of events) applyToStore(event);
		const replayed = useChatStore.getState().sessions[sessionId];
		expect({
			title: replayed.title,
			updatedAt: replayed.updatedAt,
			_meta: replayed._meta,
		}).toEqual({
			title: live.title,
			updatedAt: live.updatedAt,
			_meta: live._meta,
		});
	});

	it("keeps a pinned title while applying the remaining fields", () => {
		resetSession(true);
		applyToStore(
			createSessionInfoEvent(1, "2026-07-15T00:00:00.000Z", {
				title: null,
				updatedAt: null,
				_meta: { applied: true },
			}),
		);

		expect(useChatStore.getState().sessions[sessionId]).toEqual(
			expect.objectContaining({
				title: "Pinned title",
				updatedAt: "2026-07-15T00:00:00.000Z",
				_meta: { applied: true },
			}),
		);
	});

	it("does not let an older summary regress event activity time", () => {
		applyToStore(
			createSessionInfoEvent(1, "2026-07-15T00:00:00.000Z", {
				_meta: { applied: true },
			}),
		);

		useChatStore.getState().handleSessionsChanged({
			added: [],
			updated: [
				{
					sessionId,
					title: "Initial title",
					backendId: "backend-1",
					backendLabel: "Backend",
					createdAt: "2026-07-01T00:00:00.000Z",
					updatedAt: "2026-07-14T00:00:00.000Z",
				},
			],
			removed: [],
		});

		expect(useChatStore.getState().sessions[sessionId].updatedAt).toBe(
			"2026-07-15T00:00:00.000Z",
		);
	});
});

describe("applySessionEvent reported token usage", () => {
	const sessionId = "session-usage-1";
	const makeTurnEnd = (seq: number, usage?: unknown): SessionEvent => ({
		sessionId,
		machineId: "machine-1",
		revision: 1,
		seq,
		createdAt: `2026-07-16T00:00:0${seq}.000Z`,
		kind: "turn_end",
		payload: {
			stopReason: "end_turn",
			...(usage !== undefined ? { usage } : {}),
		},
	});

	const applyAtomically = (event: SessionEvent) => {
		useChatStore.getState().applySessionEventTransaction(event, (actions) => {
			const state = useChatStore.getState();
			applySessionEvent({
				event,
				session: state.sessions[sessionId],
				sessions: state.sessions,
				actions,
				notifications,
			});
		});
	};

	beforeEach(() => {
		useChatStore.setState({ sessions: {}, activeSessionId: undefined });
		const store = useChatStore.getState();
		store.createLocalSession(sessionId);
		store.resetSessionForRevision(sessionId, 1);
		store.updateSessionMeta(sessionId, {
			usage: {
				used: 250,
				size: 1_000,
				cost: { amount: 0.05, currency: "USD" },
			},
		});
	});

	it("overwrites snapshots without aggregating and ignores duplicate sequence replay", () => {
		applyAtomically(
			makeTurnEnd(1, {
				totalTokens: 100,
				inputTokens: 70,
				outputTokens: 30,
			}),
		);
		applyAtomically(
			makeTurnEnd(1, {
				totalTokens: 999,
				inputTokens: 999,
				outputTokens: 0,
			}),
		);
		expect(
			useChatStore.getState().sessions[sessionId].reportedTokenUsage,
		).toEqual({
			totalTokens: 100,
			inputTokens: 70,
			outputTokens: 30,
		});

		applyAtomically(
			makeTurnEnd(2, {
				totalTokens: 60,
				inputTokens: 40,
				outputTokens: 20,
				thoughtTokens: 5,
			}),
		);
		expect(useChatStore.getState().sessions[sessionId]).toEqual(
			expect.objectContaining({
				reportedTokenUsage: {
					totalTokens: 60,
					inputTokens: 40,
					outputTokens: 20,
					thoughtTokens: 5,
				},
				usage: {
					used: 250,
					size: 1_000,
					cost: { amount: 0.05, currency: "USD" },
				},
			}),
		);
	});

	it("clears absent or invalid reports and resets the snapshot with a revision", () => {
		applyAtomically(
			makeTurnEnd(1, {
				totalTokens: 100,
				inputTokens: 70,
				outputTokens: 30,
			}),
		);
		applyAtomically(makeTurnEnd(2));
		expect(
			useChatStore.getState().sessions[sessionId].reportedTokenUsage,
		).toBeUndefined();

		applyAtomically(
			makeTurnEnd(3, {
				totalTokens: 100,
				inputTokens: -1,
				outputTokens: 30,
			}),
		);
		expect(
			useChatStore.getState().sessions[sessionId].reportedTokenUsage,
		).toBeUndefined();

		useChatStore.getState().updateSessionMeta(sessionId, {
			reportedTokenUsage: {
				totalTokens: 10,
				inputTokens: 6,
				outputTokens: 4,
			},
		});
		useChatStore.getState().resetSessionForRevision(sessionId, 2);
		expect(
			useChatStore.getState().sessions[sessionId].reportedTokenUsage,
		).toBeUndefined();
	});
});
