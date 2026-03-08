import { Buffer } from "node:buffer";
import { expect, type Page, test } from "@playwright/test";

const gatewayUrl = "http://127.0.0.1:3005";
const wrongMasterSecret = Buffer.from(
	new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index)),
).toString("base64");

const buildStoredMessage = ({
	id,
	role,
	content,
}: {
	id: string;
	role: "assistant" | "user";
	content: string;
}) => ({
	id,
	role,
	kind: "text",
	content,
	contentBlocks: [{ type: "text", text: content }],
	createdAt: "2024-01-01T00:00:00Z",
	isStreaming: false,
});

const buildPersistedChatState = ({
	sessions,
	activeSessionId,
}: {
	sessions: Array<{
		sessionId: string;
		title: string;
		revision: number;
		lastAppliedSeq?: number;
		isAttached?: boolean;
		messages?: Array<{
			id: string;
			role: "assistant" | "user";
			content: string;
		}>;
	}>;
	activeSessionId: string;
}) =>
	JSON.stringify({
		state: {
			sessions: Object.fromEntries(
				sessions.map((session) => [
					session.sessionId,
					{
						sessionId: session.sessionId,
						title: session.title,
						input: "",
						inputContents: [],
						messages: (session.messages ?? []).map(buildStoredMessage),
						terminalOutputs: {},
						sending: false,
						canceling: false,
						isAttached: session.isAttached ?? false,
						isLoading: false,
						backendId: "backend-1",
						backendLabel: "Claude",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						machineId: "machine-1",
						cwd: "/repo",
						revision: session.revision,
						lastAppliedSeq: session.lastAppliedSeq ?? 0,
					},
				]),
			),
			activeSessionId,
			lastCreatedCwd: {},
		},
		version: 0,
	});

const preloadState = async (
	page: Page,
	{
		sessions,
		activeSessionId,
		masterSecret,
	}: {
		sessions: Array<{
			sessionId: string;
			title: string;
			revision: number;
			lastAppliedSeq?: number;
			isAttached?: boolean;
			messages?: Array<{
				id: string;
				role: "assistant" | "user";
				content: string;
			}>;
		}>;
		activeSessionId: string;
		masterSecret?: string;
	},
) => {
	await page.addInitScript(
		({ chatState, secret }: { chatState: string; secret?: string }) => {
			window.localStorage.clear();
			window.localStorage.setItem("mobvibe.chat-store", chatState);
			window.localStorage.setItem("mobvibe.locale", "en");
			if (secret) {
				window.localStorage.setItem("mobvibe_e2ee_master_secret", secret);
			}
		},
		{
			chatState: buildPersistedChatState({ sessions, activeSessionId }),
			secret: masterSecret,
		},
	);
};

const expectTextOrder = async (
	page: Page,
	firstText: string,
	secondText: string,
) => {
	const transcript = await page.locator("main").textContent();
	expect(transcript).toBeTruthy();
	expect(transcript?.indexOf(firstText)).toBeGreaterThanOrEqual(0);
	expect(transcript?.indexOf(secondText)).toBeGreaterThanOrEqual(0);
	expect(transcript.indexOf(firstText)).toBeLessThan(
		transcript.indexOf(secondText),
	);
};

const countOccurrences = (text: string, target: string) => {
	let count = 0;
	let startIndex = 0;
	while (true) {
		const index = text.indexOf(target, startIndex);
		if (index === -1) {
			return count;
		}
		count += 1;
		startIndex = index + target.length;
	}
};

const expectTranscript = async (
	page: Page,
	{
		present,
		absent = [],
		singles = [],
	}: {
		present: string[];
		absent?: string[];
		singles?: string[];
	},
) => {
	const transcript = await page.locator("main").textContent();
	expect(transcript).toBeTruthy();
	for (const text of present) {
		expect(transcript).toContain(text);
	}
	for (const text of absent) {
		expect(transcript).not.toContain(text);
	}
	for (const text of singles) {
		expect(countOccurrences(transcript ?? "", text)).toBe(1);
	}
};

test("restores a persisted session and backfills missed history on load", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "refresh-restore" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Restore Session",
				revision: 2,
			},
		],
	});

	await page.goto("/");

	await expect(page.getByText("Recovered after refresh")).toBeVisible();
});

test("sync history replaces stale local transcript with the authoritative chat", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sync-history" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Sync Session",
				revision: 1,
				lastAppliedSeq: 2,
				isAttached: true,
				messages: [
					{
						id: "stale-1",
						role: "assistant",
						content: "Stale local transcript",
					},
				],
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Stale local transcript")).toBeVisible();

	await page.getByLabel("Sync history").click();

	await expectTranscript(page, {
		present: ["Synced alpha line", "Synced omega line"],
		absent: ["Stale local transcript"],
		singles: ["Synced alpha line", "Synced omega line"],
	});
	await expectTextOrder(page, "Synced alpha line", "Synced omega line");
});

test("sync history remains idempotent when run repeatedly", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sync-history" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Sync Session",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: false,
				messages: [
					{
						id: "stale-1",
						role: "assistant",
						content: "Stale local transcript",
					},
				],
			},
		],
	});

	await page.goto("/");
	await expect(page.getByLabel("Sync history")).toBeEnabled();
	await page.getByLabel("Sync history").click();
	await expect(page.getByText("Synced omega line")).toBeVisible();

	await expect(page.getByLabel("Sync history")).toBeEnabled();
	await page.getByLabel("Sync history").click();

	await expectTranscript(page, {
		present: ["Synced alpha line", "Synced omega line"],
		absent: ["Stale local transcript"],
		singles: ["Synced alpha line", "Synced omega line"],
	});
});

test("sync history deduplicates live events that arrive during backfill", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sync-history-interleaved" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Sync Session",
				revision: 1,
				lastAppliedSeq: 2,
				isAttached: true,
				messages: [
					{
						id: "stale-1",
						role: "assistant",
						content: "Stale before interleave",
					},
				],
			},
		],
	});

	await page.goto("/");
	await page.getByLabel("Sync history").click();

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 1,
			seq: 3,
			text: "Interleaved live line",
		},
	});

	await expect(page.getByText("Interleaved live line")).toBeVisible();
	await expectTranscript(page, {
		present: [
			"Interleaved alpha line",
			"Interleaved beta line",
			"Interleaved live line",
		],
		absent: ["Stale before interleave"],
		singles: [
			"Interleaved alpha line",
			"Interleaved beta line",
			"Interleaved live line",
		],
	});
	await expectTextOrder(
		page,
		"Interleaved alpha line",
		"Interleaved beta line",
	);
	await expectTextOrder(page, "Interleaved beta line", "Interleaved live line");
});

test("force reload replaces the old revision transcript with the reloaded chat", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "force-reload" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Reload Session",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "old-1",
						role: "assistant",
						content: "Old revision transcript",
					},
				],
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Old revision transcript")).toBeVisible();

	await page.getByLabel("Force stop and reload?").click();
	await page.getByRole("button", { name: "Force reload" }).click();
	await expect(page.getByText("Reloaded omega line")).toBeVisible();

	await expectTranscript(page, {
		present: ["Reloaded alpha line", "Reloaded omega line"],
		absent: ["Old revision transcript"],
		singles: ["Reloaded alpha line", "Reloaded omega line"],
	});
	await expectTextOrder(page, "Reloaded alpha line", "Reloaded omega line");
});

test("force reload restores the previous transcript when reload fails", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "force-reload-failure" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Reload Failure Session",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "baseline-1",
						role: "assistant",
						content: "Reload failure baseline",
					},
				],
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Reload failure baseline")).toBeVisible();

	await page.getByLabel("Force stop and reload?").click();
	await page.getByRole("button", { name: "Force reload" }).click();
	await expect(page.getByText("Reload failure baseline")).toBeVisible();

	await expectTranscript(page, {
		present: ["Reload failure baseline"],
		absent: ["Reloaded alpha line", "Reloaded omega line"],
		singles: ["Reload failure baseline"],
	});
});

test("force reload ignores late events from the old revision", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "force-reload" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Reload Session",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "old-1",
						role: "assistant",
						content: "Old revision transcript",
					},
				],
			},
		],
	});

	await page.goto("/");
	await page.getByLabel("Force stop and reload?").click();
	await page.getByRole("button", { name: "Force reload" }).click();
	await expect(page.getByText("Reloaded omega line")).toBeVisible();

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 1,
			seq: 2,
			text: "Old revision should stay hidden",
		},
	});

	await expectTranscript(page, {
		present: ["Reloaded alpha line", "Reloaded omega line"],
		absent: ["Old revision transcript", "Old revision should stay hidden"],
		singles: ["Reloaded alpha line", "Reloaded omega line"],
	});
});

test("sidebar session load switches to the selected session transcript without mixing chats", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sidebar-load" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Session Alpha",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "alpha-1",
						role: "assistant",
						content: "Alpha final transcript",
					},
				],
			},
			{
				sessionId: "session-2",
				title: "Session Beta",
				revision: 1,
				lastAppliedSeq: 0,
				isAttached: false,
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Alpha final transcript")).toBeVisible();

	await page.getByRole("button", { name: /Session Beta/ }).click();

	await expect(page.getByText("Beta first line")).toBeVisible();
	await expect(page.getByText("Beta second line")).toBeVisible();
	await expect(page.getByText("Alpha final transcript")).toHaveCount(0);
	await expectTextOrder(page, "Beta first line", "Beta second line");

	await page.getByRole("button", { name: /Session Alpha/ }).click();
	await expect(page.getByText("Alpha final transcript")).toBeVisible();
	await expect(page.getByText("Beta first line")).toHaveCount(0);
});

test("sidebar load keeps the current chat visible when the target session fails to load", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sidebar-load-failure" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Session Alpha",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "alpha-1",
						role: "assistant",
						content: "Alpha survives load failure",
					},
				],
			},
			{
				sessionId: "session-2",
				title: "Session Beta",
				revision: 1,
				lastAppliedSeq: 0,
				isAttached: false,
			},
		],
	});

	await page.goto("/");
	await page.getByRole("button", { name: /Session Beta/ }).click();

	await expectTranscript(page, {
		present: ["Alpha survives load failure"],
		absent: ["Beta should never appear"],
		singles: ["Alpha survives load failure"],
	});
});

test("sidebar load does not let a stale delayed load steal focus from a newer session selection", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sidebar-load-race" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Session Alpha",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "alpha-1",
						role: "assistant",
						content: "Alpha baseline transcript",
					},
				],
			},
			{
				sessionId: "session-2",
				title: "Session Beta",
				revision: 1,
				lastAppliedSeq: 0,
				isAttached: false,
			},
			{
				sessionId: "session-3",
				title: "Session Gamma",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "gamma-1",
						role: "assistant",
						content: "Gamma final transcript",
					},
				],
			},
		],
	});

	await page.goto("/");
	await page.getByRole("button", { name: /Session Beta/ }).click();
	await page.getByRole("button", { name: /Session Gamma/ }).click();

	await expect(page.getByText("Gamma final transcript")).toBeVisible();
	await expect(page.getByText("Beta delayed transcript")).toHaveCount(0);
	await expect(page.getByText("Alpha baseline transcript")).toHaveCount(0);
});

test("sidebar session switching keeps old-session live events out of the visible chat", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sidebar-load" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Session Alpha",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "alpha-1",
						role: "assistant",
						content: "Alpha final transcript",
					},
				],
			},
			{
				sessionId: "session-2",
				title: "Session Beta",
				revision: 1,
				lastAppliedSeq: 0,
				isAttached: false,
			},
		],
	});

	await page.goto("/");
	await page.getByRole("button", { name: /Session Beta/ }).click();
	await expect(page.getByText("Beta second line")).toBeVisible();

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 1,
			seq: 2,
			text: "Alpha late line",
		},
	});

	await expectTranscript(page, {
		present: ["Beta first line", "Beta second line"],
		absent: ["Alpha final transcript", "Alpha late line"],
		singles: ["Beta first line", "Beta second line"],
	});
});

test("mobile chat flows keep the final transcript correct for sync, reload, and session load", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sidebar-load" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Session Alpha",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "alpha-stale",
						role: "assistant",
						content: "Alpha mobile stale transcript",
					},
				],
			},
			{
				sessionId: "session-2",
				title: "Session Beta",
				revision: 1,
				lastAppliedSeq: 0,
				isAttached: false,
			},
		],
	});

	await page.goto("/");

	await page.getByLabel("Sync history").click();
	await expect(page.getByText("Alpha final transcript")).toBeVisible();
	await expectTranscript(page, {
		present: ["Alpha final transcript"],
		absent: ["Alpha mobile stale transcript"],
		singles: ["Alpha final transcript"],
	});

	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "force-reload" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Reload Session",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "old-mobile-1",
						role: "assistant",
						content: "Old revision transcript",
					},
				],
			},
		],
	});
	await page.goto("/");
	await page.getByLabel("Force stop and reload?").click();
	await page.getByRole("button", { name: "Force reload" }).click();
	await expect(page.getByText("Reloaded omega line")).toBeVisible();
	await expectTranscript(page, {
		present: ["Reloaded alpha line", "Reloaded omega line"],
		absent: ["Old revision transcript"],
		singles: ["Reloaded alpha line", "Reloaded omega line"],
	});

	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "sidebar-load" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Session Alpha",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: true,
				messages: [
					{
						id: "alpha-1",
						role: "assistant",
						content: "Alpha final transcript",
					},
				],
			},
			{
				sessionId: "session-2",
				title: "Session Beta",
				revision: 1,
				lastAppliedSeq: 0,
				isAttached: false,
			},
		],
	});
	await page.goto("/");
	await page.getByLabel("Toggle menu").click();
	await page.getByRole("button", { name: /Session Beta/ }).click();
	await expect(page.getByText("Beta second line")).toBeVisible();
	await expectTranscript(page, {
		present: ["Beta first line", "Beta second line"],
		absent: ["Alpha final transcript"],
		singles: ["Beta first line", "Beta second line"],
	});
});

test("reload backfills events missed after live cursor advancement", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "reconnect-gap" },
	});
	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Reconnect Session",
				revision: 1,
			},
		],
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

	await expect(page.getByText("Seen before disconnect")).toBeVisible();
	await expect(page.getByText("Recovered after reconnect")).toBeVisible();
	await expectTextOrder(
		page,
		"Seen before disconnect",
		"Recovered after reconnect",
	);
});

test("decrypts only the current revision when a key exists", async ({
	page,
	request,
}) => {
	const reset = await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-revision" },
	});
	const { masterSecret } = (await reset.json()) as { masterSecret: string };

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Encrypted Revision Session",
				revision: 2,
			},
		],
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

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Encrypted Revision Session",
				revision: 2,
			},
		],
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
