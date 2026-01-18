import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "../src/lib/chat-store";

const resetStore = () => {
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
		appError: undefined,
	});
};

describe("useChatStore", () => {
	beforeEach(() => {
		useChatStore.persist.clearStorage();
		resetStore();
	});

	it("creates a local session when missing", () => {
		useChatStore.getState().createLocalSession("session-1", {
			title: "测试对话",
			state: "ready",
		});

		const session = useChatStore.getState().sessions["session-1"];
		expect(session).toBeTruthy();
		expect(session.title).toBe("测试对话");
		expect(session.state).toBe("ready");
	});

	it("streams assistant messages and finalizes", () => {
		const store = useChatStore.getState();
		store.addUserMessage("session-1", "你好");
		store.appendAssistantChunk("session-1", "你好，我是");
		store.appendAssistantChunk("session-1", "助手");
		store.finalizeAssistantMessage("session-1");

		const session = useChatStore.getState().sessions["session-1"];
		expect(session.messages).toHaveLength(2);
		expect(session.messages[0].role).toBe("user");
		expect(session.messages[0].isStreaming).toBe(false);
		expect(session.messages[1].role).toBe("assistant");
		if (session.messages[1].kind === "text") {
			expect(session.messages[1].content).toBe("你好，我是助手");
		}
		expect(session.messages[1].isStreaming).toBe(false);
		expect(session.streamingMessageId).toBeUndefined();
	});

	it("marks missing sessions as stopped", () => {
		useChatStore.getState().createLocalSession("session-1", {
			title: "旧对话",
			state: "ready",
		});

		useChatStore.getState().syncSessions([]);

		const session = useChatStore.getState().sessions["session-1"];
		expect(session.state).toBe("stopped");
		expect(session.error?.code).toBe("SESSION_NOT_FOUND");
	});
});
