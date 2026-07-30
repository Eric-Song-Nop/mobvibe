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

	it("rehydrates structured assistant and thought blocks", async () => {
		const event = { sessionId: "s1", revision: 1, seq: 1 };
		const image = {
			type: "image" as const,
			data: "aW1hZ2U=",
			mimeType: "image/png",
			_meta: { source: "agent" },
		};
		const resource = {
			type: "resource" as const,
			resource: {
				uri: "file:///workspace/reasoning.txt",
				text: "reasoning context",
			},
		};
		useChatStore.getState().applySessionEventTransaction(event, (actions) => {
			actions.appendAssistantChunk("s1", image, "assistant-rich");
			actions.appendThoughtChunk("s1", resource, "thought-rich");
		});

		const snapshot = memory.getRaw();
		resetStore();
		memory.setRaw(snapshot);
		await useChatStore.persist.rehydrate();

		const messages = useChatStore.getState().sessions.s1.messages;
		expect(messages[0]).toMatchObject({ contentBlocks: [image] });
		expect(messages[1]).toMatchObject({ contentBlocks: [resource] });
	});

	it("sanitizes tampered current-version plan state on every hydration", async () => {
		const store = useChatStore.getState();
		store.addUserMessage("s1", "persisted message");
		store.updateSessionCursor("s1", 4, 7);
		const persisted = JSON.parse(memory.getRaw() ?? "{}") as {
			state: { sessions: Record<string, Record<string, unknown>> };
			version: number;
		};
		persisted.version = 2;
		persisted.state.sessions.s1.plan = [
			{ content: "unsafe", priority: "urgent", status: "pending" },
		];
		persisted.state.sessions.s1.plans = Array.from(
			{ length: 17 },
			(_, index) => ({
				type: "file",
				planId: `plan-${index}`,
				uri: `file:///workspace/${index}.md`,
				untrusted: "drop-me",
			}),
		);

		resetStore();
		memory.setRaw(JSON.stringify(persisted));
		await useChatStore.persist.rehydrate();

		const restored = useChatStore.getState();
		expect(restored.sessions.s1.plan).toBeUndefined();
		expect(restored.sessions.s1.plans).toHaveLength(16);
		expect(restored.sessions.s1.plans?.[0]).toEqual({
			type: "file",
			planId: "plan-0",
			uri: "file:///workspace/0.md",
		});
		expect(restored.sessions.s1.messages[0]).toMatchObject({
			content: "persisted message",
		});
		expect(restored.sessions.s1).toMatchObject({
			revision: 4,
			lastAppliedSeq: 7,
		});
		expect(restored.upsertPlan).toBeTypeOf("function");
		expect(restored.removePlan).toBeTypeOf("function");
	});

	it("migrates version-one legacy and operation plans through the sanitizer", async () => {
		const store = useChatStore.getState();
		store.addUserMessage("s1", "migration keeps history");
		store.updateSessionCursor("s1", 3, 5);
		const persisted = JSON.parse(memory.getRaw() ?? "{}") as {
			state: { sessions: Record<string, Record<string, unknown>> };
			version: number;
		};
		persisted.version = 1;
		persisted.state.sessions.s1.plan = [
			{
				content: "Legacy",
				priority: "low",
				status: "pending",
				untrusted: true,
			},
		];
		persisted.state.sessions.s1.plans = [
			{
				type: "markdown",
				planId: "plan-a",
				content: "",
				untrusted: true,
			},
			{ type: "unknown", planId: "bad", content: "drop" },
		];

		resetStore();
		memory.setRaw(JSON.stringify(persisted));
		await useChatStore.persist.rehydrate();

		const restored = useChatStore.getState().sessions.s1;
		expect(restored.plan).toEqual([
			{ content: "Legacy", priority: "low", status: "pending" },
		]);
		expect(restored.plans).toEqual([
			{ type: "markdown", planId: "plan-a", content: "" },
		]);
		expect(restored.messages[0]).toMatchObject({
			content: "migration keeps history",
		});
		expect(restored).toMatchObject({ revision: 3, lastAppliedSeq: 5 });
	});
});
