import {
	base64ToUint8,
	deriveAuthKeyPair,
	initCrypto,
	uint8ToBase64,
} from "@mobvibe/shared";
import { expect, type Page, test } from "@playwright/test";
import {
	expectTextOrder,
	fillComposer,
	gatewayUrl,
	preloadState,
	wrongMasterSecret,
} from "./test-helpers";

const addDevice = async (page: Page, secret: string) => {
	await page
		.locator('input[placeholder="Paste master secret (base64)"]:visible')
		.first()
		.fill(secret);
	await page.getByRole("button", { name: "Add Device" }).first().click();
};

const clickSend = async (page: Page) => {
	await page.getByRole("button", { name: "Send", exact: true }).click();
};

const computeFingerprint = (base64Secret: string) => {
	const authKeyPair = deriveAuthKeyPair(base64ToUint8(base64Secret));
	return uint8ToBase64(authKeyPair.publicKey).slice(0, 8);
};

test("shows missing-key state and keeps encrypted history hidden on load", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-buffered" },
	});

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Encrypted Buffer Session",
				revision: 1,
			},
		],
	});

	await page.goto("/");

	await expect(page.getByRole("alert")).toContainText("E2EE key missing");
	await expect(
		page.getByRole("button", {
			name: /Encrypted Buffer Session .* Key missing/,
		}),
	).toBeVisible();
	await expect(page.getByText("Buffered history line")).toHaveCount(0);
});

test("manual pairing flushes buffered encrypted history and live events", async ({
	page,
	request,
}) => {
	const reset = await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-buffered" },
	});
	const {
		secrets: { primary },
	} = (await reset.json()) as {
		secrets: { primary: string };
	};

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Encrypted Buffer Session",
				revision: 1,
			},
		],
	});

	await page.goto("/");
	await expect(page.getByText("Buffered history line")).toHaveCount(0);

	await request.post(`${gatewayUrl}/__test__/emit-event`, {
		data: {
			sessionId: "session-1",
			revision: 1,
			seq: 2,
			text: "Buffered live line",
			encrypted: true,
		},
	});
	await expect(page.getByText("Buffered live line")).toHaveCount(0);

	await page.getByRole("link", { name: "Go to E2EE Settings" }).click();
	await addDevice(page, primary);
	await expect(
		page.getByText("E2EE Paired (1 device(s))").first(),
	).toBeVisible();
	await page.getByRole("button", { name: "Back" }).click();

	await expect(page.getByRole("alert")).toHaveCount(0);
	await expect(page.getByText("Buffered history line")).toBeVisible();
	await expect(page.getByText("Buffered live line")).toBeVisible();
	await expectTextOrder(page, "Buffered history line", "Buffered live line");
});

test("tries multiple paired secrets until one decrypts the session", async ({
	page,
	request,
}) => {
	const reset = await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-secondary-key" },
	});
	const {
		secrets: { secondary },
	} = (await reset.json()) as {
		secrets: { secondary: string };
	};

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Secondary Key Session",
				revision: 1,
			},
		],
	});

	await page.goto("/");
	await page.getByRole("link", { name: "Go to E2EE Settings" }).click();

	await addDevice(page, wrongMasterSecret);
	await expect(
		page.getByText("E2EE Paired (1 device(s))").first(),
	).toBeVisible();

	await addDevice(page, secondary);
	await expect(
		page.getByText("E2EE Paired (2 device(s))").first(),
	).toBeVisible();
	await page.getByRole("button", { name: "Back" }).click();

	await expect(page.getByText("Secondary key history line")).toBeVisible();
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("removing the matching secret makes the session unreadable after reload", async ({
	page,
	request,
}) => {
	const reset = await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-secondary-key" },
	});
	const {
		secrets: { secondary },
	} = (await reset.json()) as {
		secrets: { secondary: string };
	};
	await initCrypto();
	const secondaryFingerprint = computeFingerprint(secondary);

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Secondary Key Session",
				revision: 1,
			},
		],
		pairedSecrets: [secondary],
	});

	await page.goto("/");
	await expect(page.getByText("Secondary key history line")).toBeVisible();

	await page.goto("/settings#security");
	await expect(
		page.getByText("E2EE Paired (1 device(s))").first(),
	).toBeVisible();
	const deviceRow = page
		.locator(`code:visible:text-is("${secondaryFingerprint}...")`)
		.first()
		.locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
	await deviceRow.getByRole("button", { name: "Remove" }).click();
	await page.getByRole("button", { name: "Remove" }).last().click();
	await expect(page.getByText("E2EE Not Paired").first()).toBeVisible();

	const reloadedPage = await page.context().newPage();
	await reloadedPage.goto("/");

	await expect(reloadedPage.getByRole("alert")).toContainText(
		"E2EE key missing",
	);
	await expect(
		reloadedPage.getByText("Secondary key history line"),
	).toHaveCount(0);
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

test("sends encrypted prompts and renders the encrypted round-trip response", async ({
	page,
	request,
}) => {
	const reset = await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-send" },
	});
	const { masterSecret } = (await reset.json()) as { masterSecret: string };

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Encrypted Send Session",
				revision: 1,
				isAttached: true,
			},
		],
		masterSecret,
	});

	await page.goto("/");
	await fillComposer(page, "Top secret prompt");
	await clickSend(page);

	await expect(page.getByText("Encrypted assistant reply")).toBeVisible();

	const response = await request.get(`${gatewayUrl}/__test__/messages`);
	const payload = (await response.json()) as {
		messages: Array<{
			prompt: { t: string; c: string };
			decryptedPrompt: Array<{ type: string; text?: string }>;
		}>;
	};

	expect(payload.messages).toHaveLength(1);
	expect(payload.messages[0]?.prompt.t).toBe("encrypted");
	expect(Array.isArray(payload.messages[0]?.prompt)).toBe(false);
	expect(payload.messages[0]?.decryptedPrompt).toEqual([
		{ type: "text", text: "Top secret prompt" },
	]);
});

test("fails closed before sending when the session key is missing", async ({
	page,
	request,
}) => {
	await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-send" },
	});

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Encrypted Send Session",
				revision: 1,
				isAttached: true,
			},
		],
	});

	await page.goto("/");
	await fillComposer(page, "Blocked prompt");
	await clickSend(page);

	await expect(
		page.getByText(
			"E2EE key missing. Pair this device before sending messages.",
		),
	).toBeVisible();

	const response = await request.get(`${gatewayUrl}/__test__/messages`);
	const payload = (await response.json()) as { messages: unknown[] };
	expect(payload.messages).toHaveLength(0);
});

test("auto-activates a detached cached session before sending", async ({
	page,
	request,
}) => {
	const reset = await request.post(`${gatewayUrl}/__test__/reset`, {
		data: { scenario: "encrypted-detached-send" },
	});
	const { masterSecret } = (await reset.json()) as { masterSecret: string };

	await preloadState(page, {
		activeSessionId: "session-1",
		sessions: [
			{
				sessionId: "session-1",
				title: "Encrypted Detached Send Session",
				revision: 1,
				lastAppliedSeq: 1,
				isAttached: false,
				messages: [
					{
						id: "cached-1",
						role: "assistant",
						content: "Cached detached transcript",
					},
				],
			},
		],
		masterSecret,
	});

	await page.goto("/");
	await expect(page.getByText("Cached detached transcript")).toBeVisible();

	await fillComposer(page, "Wake this session");
	await clickSend(page);

	await expect(
		page.getByText("Detached encrypted assistant reply"),
	).toBeVisible();

	const response = await request.get(`${gatewayUrl}/__test__/messages`);
	const payload = (await response.json()) as {
		messages: Array<{
			decryptedPrompt: Array<{ type: string; text?: string }>;
		}>;
	};

	expect(payload.messages).toHaveLength(1);
	expect(payload.messages[0]?.decryptedPrompt).toEqual([
		{ type: "text", text: "Wake this session" },
	]);
});
