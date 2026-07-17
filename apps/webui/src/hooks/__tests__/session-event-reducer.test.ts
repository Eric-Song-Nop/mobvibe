import { describe, expect, it, vi } from "vitest";
import {
	applySessionEvent,
	type SessionEventNotifications,
	type SessionEventReducerActions,
} from "@/hooks/session-event-reducer";
import type { ContentBlock, SessionEvent } from "@/lib/acp";

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
			"Hello",
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
			"there",
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
			"Reasoning",
			"thought-1",
		);
	});
});
