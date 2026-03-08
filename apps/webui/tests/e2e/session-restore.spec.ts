import { Buffer } from "node:buffer";
import { expect, type Page, test } from "@playwright/test";

const gatewayUrl = "http://127.0.0.1:3005";
const wrongMasterSecret = Buffer.from(
	new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index)),
).toString("base64");

const buildPersistedChatState = ({
	sessionId = "session-1",
	title,
	revision,
	lastAppliedSeq = 0,
}: {
	sessionId?: string;
	title: string;
	revision: number;
	lastAppliedSeq?: number;
}) =>
	JSON.stringify({
		state: {
			sessions: {
				[sessionId]: {
					sessionId,
					title,
					input: "",
					inputContents: [],
					messages: [],
					terminalOutputs: {},
					sending: false,
					canceling: false,
					isAttached: false,
					isLoading: false,
					backendId: "backend-1",
					backendLabel: "Claude",
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
					machineId: "machine-1",
					cwd: "/repo",
					revision,
					lastAppliedSeq,
				},
			},
			activeSessionId: sessionId,
			lastCreatedCwd: {},
		},
		version: 0,
	});

const preloadSession = async (
	page: Page,
	{
		title,
		revision,
		lastAppliedSeq,
		masterSecret,
	}: {
		title: string;
		revision: number;
		lastAppliedSeq?: number;
		masterSecret?: string;
	},
) => {
	await page.addInitScript(
		({ chatState, secret }: { chatState: string; secret?: string }) => {
			window.localStorage.clear();
			window.localStorage.setItem("mobvibe.chat-store", chatState);
			if (secret) {
				window.localStorage.setItem("mobvibe_e2ee_master_secret", secret);
			}
		},
		{
			chatState: buildPersistedChatState({
				title,
				revision,
				lastAppliedSeq,
			}),
			secret: masterSecret,
		},
	);
};

test("restores a persisted session and backfills missed history on load", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "refresh-restore" },
	});
	await preloadSession(page, {
		title: "Restore Session",
		revision: 2,
	});

	await page.goto("/");

	await expect(page.getByText("Recovered after refresh")).toBeVisible();
});

test("reload backfills events missed after live cursor advancement", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "reconnect-gap" },
	});
	await preloadSession(page, {
		title: "Reconnect Session",
		revision: 1,
	});

	await page.goto("/");

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 1,
			seq: 1,
			text: "Seen before disconnect",
		},
	});
	await expect(page.getByText("Seen before disconnect")).toBeVisible();

	await request.post(`${gatewayUrl}/__test__/append-event`, {
		data: {
			sessionId: "session-1",
			revision: 1,
			seq: 2,
			text: "Recovered after reconnect",
		},
	});
	await page.reload();

	await expect(page.getByText("Recovered after reconnect")).toBeVisible();
});

test("decrypts only the current revision when a key exists", async ({
	page,
	request,
}) => {
	const reset = await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-revision" },
	});
	const { masterSecret } = (await reset.json()) as { masterSecret: string };

	await preloadSession(page, {
		title: "Encrypted Revision Session",
		revision: 2,
		masterSecret,
	});

	await page.goto("/");

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 1,
			seq: 1,
			text: "stale encrypted revision",
			encrypted: true,
		},
	});
	await expect(page.getByText("stale encrypted revision")).toHaveCount(0);

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 2,
			seq: 1,
			text: "current encrypted revision",
			encrypted: true,
		},
	});

	await expect(page.getByText("current encrypted revision")).toBeVisible();
});

test("keeps encrypted restore content hidden when the paired key is wrong", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-revision" },
	});

	await preloadSession(page, {
		title: "Encrypted Revision Session",
		revision: 2,
		masterSecret: wrongMasterSecret,
	});

	await page.goto("/");

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 2,
			seq: 1,
			text: "should stay encrypted",
			encrypted: true,
		},
	});

	await expect(page.getByText("should stay encrypted")).toHaveCount(0);
});
