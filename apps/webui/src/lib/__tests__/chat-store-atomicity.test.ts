import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "../chat-store";
import { type SyncStateStorage, setStorageAdapter } from "../storage-adapter";

type MemoryStorage = {
	storage: SyncStateStorage;
	getRaw: () => string | null;
	setRaw: (value: string | null) => void;
	writes: string[];
};

const createMemoryStorage = (): MemoryStorage => {
	let raw: string | null = null;
	const writes: string[] = [];

	return {
		storage: {
			getItem: () => raw,
			setItem: (_name, value) => {
				raw = value;
				writes.push(value);
			},
			removeItem: () => {
				raw = null;
			},
		},
		getRaw: () => raw,
		setRaw: (value) => {
			raw = value;
		},
		writes,
	};
};

const resetStore = () => {
	useChatStore.setState({
		sessions: {},
		activeSessionId: undefined,
		lastCreatedCwd: {},
		appError: undefined,
		syncStatus: "idle",
		lastSyncAt: undefined,
	});
};

describe("chat-store session event atomicity", () => {
	let memory: MemoryStorage;

	beforeEach(() => {
		memory = createMemoryStorage();
		setStorageAdapter(memory.storage);
		resetStore();

		const store = useChatStore.getState();
		store.createLocalSession("s1");
		store.updateSessionCursor("s1", 1, 0);
		memory.writes.length = 0;
	});

	it("hydrates and replays a crash snapshot without duplicating an event", async () => {
		const event = { sessionId: "s1", revision: 1, seq: 1 };
		useChatStore.getState().applySessionEventTransaction(event, (actions) => {
			actions.appendAssistantChunk("s1", "only once");
		});

		expect(memory.writes).toHaveLength(1);
		const crashSnapshot = memory.getRaw();
		expect(crashSnapshot).not.toBeNull();

		resetStore();
		memory.setRaw(crashSnapshot);
		await useChatStore.persist.rehydrate();

		let restored = useChatStore.getState().sessions.s1;
		expect(restored.lastAppliedSeq).toBe(1);
		expect(restored.messages).toHaveLength(1);
		expect(restored.messages[0]).toMatchObject({ content: "only once" });

		useChatStore.getState().applySessionEventTransaction(event, (actions) => {
			actions.appendAssistantChunk("s1", "only once");
		});

		restored = useChatStore.getState().sessions.s1;
		expect(restored.lastAppliedSeq).toBe(1);
		expect(restored.messages).toHaveLength(1);
		expect(restored.messages[0]).toMatchObject({ content: "only once" });
	});
});
