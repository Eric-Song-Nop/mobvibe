import { Buffer } from "node:buffer";
import { expect, type Page } from "@playwright/test";

export const gatewayUrl = "http://127.0.0.1:3005";

export const wrongMasterSecret = Buffer.from(
	new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index)),
).toString("base64");

type StoredMessage = {
	id: string;
	role: "assistant" | "user";
	content: string;
};

type StoredSession = {
	sessionId: string;
	title: string;
	revision: number;
	lastAppliedSeq?: number;
	isAttached?: boolean;
	messages?: StoredMessage[];
};

const buildStoredMessage = ({ id, role, content }: StoredMessage) => ({
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
	sessions: StoredSession[];
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

export const preloadState = async (
	page: Page,
	{
		sessions,
		activeSessionId,
		masterSecret,
		pairedSecrets,
	}: {
		sessions: StoredSession[];
		activeSessionId: string;
		masterSecret?: string;
		pairedSecrets?: string[];
	},
) => {
	await page.addInitScript(
		({
			chatState,
			secret,
			secrets,
		}: {
			chatState: string;
			secret?: string;
			secrets?: string[];
		}) => {
			window.localStorage.clear();
			window.localStorage.setItem("mobvibe.chat-store", chatState);
			window.localStorage.setItem("mobvibe.locale", "en");
			if (secret) {
				window.localStorage.setItem("mobvibe_e2ee_master_secret", secret);
			}
			if (secrets && secrets.length > 0) {
				window.localStorage.setItem(
					"mobvibe_e2ee_secrets",
					JSON.stringify(
						secrets.map((storedSecret, index) => ({
							secret: storedSecret,
							fingerprint: `test-${index + 1}`,
							addedAt: Date.now() + index,
						})),
					),
				);
			}
		},
		{
			chatState: buildPersistedChatState({ sessions, activeSessionId }),
			secret: masterSecret,
			secrets: pairedSecrets,
		},
	);
};

export const expectTextOrder = async (
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

export const expectTranscript = async (
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

export const fillComposer = async (page: Page, text: string) => {
	const composer = page.getByRole("textbox", {
		name: "Type a message, Enter to send, Shift+Enter for newline",
	});
	await composer.click();
	await composer.fill(text);
};
