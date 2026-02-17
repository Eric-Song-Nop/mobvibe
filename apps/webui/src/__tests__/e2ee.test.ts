import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@/lib/acp";

const mockInitCrypto = vi.fn().mockResolvedValue(undefined);
const mockGetSodium = vi.fn(() => ({
	from_base64: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
	to_base64: (arr: Uint8Array) => Buffer.from(arr).toString("base64"),
	base64_variants: { ORIGINAL: 0 },
}));
const mockDeriveContentKeyPair = vi.fn((_masterSecret: Uint8Array) => ({
	publicKey: new Uint8Array([1, 2, 3]),
	secretKey: new Uint8Array([4, 5, 6]),
}));
const mockDeriveAuthKeyPair = vi.fn((_masterSecret: Uint8Array) => ({
	publicKey: new Uint8Array([10, 11, 12]),
	secretKey: new Uint8Array([13, 14, 15]),
}));
const mockUnwrapDEK = vi.fn(() => new Uint8Array([10, 20, 30]));
const mockDecryptPayload = vi.fn((encrypted: { t: string; c: string }) =>
	JSON.parse(atob(encrypted.c)),
);
const mockEncryptPayload = vi.fn((payload: unknown, _dek: Uint8Array) => ({
	t: "encrypted",
	c: btoa(JSON.stringify(payload)),
}));
const mockIsEncryptedPayload = vi.fn(
	(p: unknown) =>
		typeof p === "object" &&
		p !== null &&
		"t" in p &&
		(p as Record<string, unknown>).t === "encrypted",
);

vi.mock("@mobvibe/core", () => ({
	initCrypto: mockInitCrypto,
	getSodium: mockGetSodium,
	deriveContentKeyPair: mockDeriveContentKeyPair,
	deriveAuthKeyPair: mockDeriveAuthKeyPair,
	unwrapDEK: mockUnwrapDEK,
	decryptPayload: mockDecryptPayload,
	encryptPayload: mockEncryptPayload,
	isEncryptedPayload: mockIsEncryptedPayload,
}));

vi.mock("@/lib/auth", () => ({
	isInTauri: () => false,
}));

function makeEvent(sessionId: string, payload: unknown): SessionEvent {
	return {
		sessionId,
		machineId: "machine-1",
		revision: 1,
		seq: 1,
		kind: "user_message",
		createdAt: new Date().toISOString(),
		payload,
	};
}

const { e2ee } = await import("@/lib/e2ee");

describe("E2EEManager", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
		mockDeriveContentKeyPair.mockImplementation((secret) => ({
			publicKey: new Uint8Array([...secret.slice(0, 3)]),
			secretKey: new Uint8Array([...secret.slice(3, 6)]),
		}));
		mockDeriveAuthKeyPair.mockImplementation(() => ({
			publicKey: new Uint8Array([10, 11, 12]),
			secretKey: new Uint8Array([13, 14, 15]),
		}));
	});

	afterEach(async () => {
		await e2ee.clearSecret();
	});

	it("isEnabled() returns false initially", () => {
		expect(e2ee.isEnabled()).toBe(false);
	});

	it("addPairedSecret makes isEnabled() return true", async () => {
		await e2ee.addPairedSecret(btoa("test-secret"));
		expect(e2ee.isEnabled()).toBe(true);
		expect(mockInitCrypto).toHaveBeenCalled();
		expect(mockDeriveContentKeyPair).toHaveBeenCalled();
	});

	it("clearSecret makes isEnabled() return false and clears localStorage", async () => {
		await e2ee.addPairedSecret(btoa("test-secret"));
		expect(e2ee.isEnabled()).toBe(true);

		await e2ee.clearSecret();
		expect(e2ee.isEnabled()).toBe(false);
		expect(localStorage.getItem("mobvibe_e2ee_secrets")).toBeNull();
	});

	it("unwrapSessionDek returns false when not enabled", () => {
		expect(e2ee.unwrapSessionDek("session-1", "wrapped-dek")).toBe(false);
	});

	it("unwrapSessionDek returns true after pairing", async () => {
		await e2ee.addPairedSecret(btoa("test-secret"));
		const result = e2ee.unwrapSessionDek("session-1", "wrapped-dek-base64");
		expect(result).toBe(true);
		expect(mockUnwrapDEK).toHaveBeenCalledWith(
			"wrapped-dek-base64",
			expect.any(Uint8Array),
			expect.any(Uint8Array),
		);
	});

	it("decryptEvent passes through non-encrypted payloads unchanged", () => {
		const event = makeEvent("session-1", { text: "plain" });
		const result = e2ee.decryptEvent(event);
		expect(result).toBe(event);
	});

	it("decryptEvent decrypts encrypted payloads", async () => {
		await e2ee.addPairedSecret(btoa("test-secret"));
		e2ee.unwrapSessionDek("session-1", "wrapped-dek");

		const original = { text: "decrypted" };
		const encrypted = { t: "encrypted", c: btoa(JSON.stringify(original)) };
		const event = makeEvent("session-1", encrypted);

		const result = e2ee.decryptEvent(event);
		expect(result.payload).toEqual(original);
		expect(mockDecryptPayload).toHaveBeenCalled();
	});

	it("decryptEvent logs warning on failure", async () => {
		await e2ee.addPairedSecret(btoa("test-secret"));
		e2ee.unwrapSessionDek("session-1", "wrapped-dek");

		mockDecryptPayload.mockImplementationOnce(() => {
			throw new Error("decrypt failed");
		});

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const event = makeEvent("session-1", {
			t: "encrypted",
			c: "bad-data",
		});

		const result = e2ee.decryptEvent(event);
		expect(result).toEqual(event);
		expect(warnSpy).toHaveBeenCalledWith(
			"[E2EE] Failed to decrypt event",
			"session-1",
			expect.any(Error),
		);
		warnSpy.mockRestore();
	});

	it("loadFromStorage restores state from localStorage", async () => {
		const secrets = [
			{
				secret: btoa("stored-secret"),
				fingerprint: "test",
				addedAt: Date.now(),
			},
		];
		localStorage.setItem("mobvibe_e2ee_secrets", JSON.stringify(secrets));

		const result = await e2ee.loadFromStorage();
		expect(result).toBe(true);
		expect(e2ee.isEnabled()).toBe(true);
	});

	it("loadFromStorage returns false when no stored secret", async () => {
		const result = await e2ee.loadFromStorage();
		expect(result).toBe(false);
		expect(e2ee.isEnabled()).toBe(false);
	});

	it("loadFromStorage migrates legacy single-secret format", async () => {
		const secret = btoa("legacy-secret");
		localStorage.setItem("mobvibe_e2ee_master_secret", secret);

		const result = await e2ee.loadFromStorage();
		expect(result).toBe(true);
		expect(e2ee.isEnabled()).toBe(true);
		expect(localStorage.getItem("mobvibe_e2ee_master_secret")).toBeNull();
	});

	describe("multi-secret support", () => {
		it("supports multiple paired secrets", async () => {
			await e2ee.addPairedSecret(btoa("secret-a"));
			await e2ee.addPairedSecret(btoa("secret-b"));
			await e2ee.addPairedSecret(btoa("secret-c"));

			expect(e2ee.isEnabled()).toBe(true);
			const devices = e2ee.getPairedSecrets();
			expect(devices).toHaveLength(3);
		});

		it("does not add duplicate secrets", async () => {
			const secret = btoa("same-secret");
			await e2ee.addPairedSecret(secret);
			await e2ee.addPairedSecret(secret);

			const devices = e2ee.getPairedSecrets();
			expect(devices).toHaveLength(1);
		});

		it("removePairedSecret removes a specific secret", async () => {
			const secretA = btoa("secret-a");
			const secretB = btoa("secret-b");
			await e2ee.addPairedSecret(secretA);
			await e2ee.addPairedSecret(secretB);

			await e2ee.removePairedSecret(secretA);

			const devices = e2ee.getPairedSecrets();
			expect(devices).toHaveLength(1);
		});

		it("unwrapSessionDek tries all secrets until one succeeds", async () => {
			const secretA = btoa("secret-a");
			const secretB = btoa("secret-b");
			await e2ee.addPairedSecret(secretA);
			await e2ee.addPairedSecret(secretB);

			mockUnwrapDEK.mockImplementationOnce(() => {
				throw new Error("wrong key");
			});
			mockUnwrapDEK.mockImplementationOnce(() => new Uint8Array([10, 20, 30]));

			const result = e2ee.unwrapSessionDek("session-1", "wrapped-dek");
			expect(result).toBe(true);
			expect(mockUnwrapDEK).toHaveBeenCalledTimes(2);
		});

		it("unwrapSessionDek caches successful secret mapping", async () => {
			const secretA = btoa("secret-a");
			const secretB = btoa("secret-b");
			await e2ee.addPairedSecret(secretA);
			await e2ee.addPairedSecret(secretB);

			mockUnwrapDEK.mockImplementationOnce(() => {
				throw new Error("wrong key");
			});
			mockUnwrapDEK.mockImplementationOnce(() => new Uint8Array([10, 20, 30]));

			e2ee.unwrapSessionDek("session-1", "wrapped-dek");

			mockUnwrapDEK.mockClear();
			mockUnwrapDEK.mockImplementation(() => new Uint8Array([10, 20, 30]));

			e2ee.unwrapSessionDek("session-1", "wrapped-dek-2");

			expect(mockUnwrapDEK).toHaveBeenCalledTimes(1);
		});

		it("removePairedSecret clears related session caches", async () => {
			const secretA = btoa("secret-a");
			const secretB = btoa("secret-b");
			await e2ee.addPairedSecret(secretA);
			await e2ee.addPairedSecret(secretB);

			mockUnwrapDEK.mockImplementation(() => new Uint8Array([10, 20, 30]));
			e2ee.unwrapSessionDek("session-1", "wrapped-dek");

			await e2ee.removePairedSecret(secretA);

			mockUnwrapDEK.mockClear();
			mockUnwrapDEK.mockImplementation(() => new Uint8Array([10, 20, 30]));

			e2ee.unwrapSessionDek("session-1", "wrapped-dek-2");

			expect(mockUnwrapDEK).toHaveBeenCalledTimes(1);
		});

		it("persists multiple secrets to localStorage", async () => {
			await e2ee.addPairedSecret(btoa("secret-a"));
			await e2ee.addPairedSecret(btoa("secret-b"));

			const stored = localStorage.getItem("mobvibe_e2ee_secrets");
			expect(stored).not.toBeNull();
			const parsed = JSON.parse(stored as string);
			expect(parsed).toHaveLength(2);
		});
	});

	describe("bidirectional encryption", () => {
		it("encryptPayloadForSession returns plaintext when no DEK", () => {
			const payload = [{ type: "text", text: "hello" }];
			const result = e2ee.encryptPayloadForSession("session-no-dek", payload);
			expect(result).toBe(payload);
			expect(mockEncryptPayload).not.toHaveBeenCalled();
		});

		it("encryptPayloadForSession encrypts when DEK exists", async () => {
			await e2ee.addPairedSecret(btoa("test-secret"));
			e2ee.unwrapSessionDek("session-1", "wrapped-dek");

			const payload = [{ type: "text", text: "hello" }];
			const result = e2ee.encryptPayloadForSession("session-1", payload);

			expect(mockEncryptPayload).toHaveBeenCalledWith(
				payload,
				expect.any(Uint8Array),
			);
			expect(result).toEqual({
				t: "encrypted",
				c: expect.any(String),
			});
		});

		it("round-trip: encrypt then decrypt same DEK", async () => {
			await e2ee.addPairedSecret(btoa("test-secret"));
			e2ee.unwrapSessionDek("session-rt", "wrapped-dek");

			const original = [{ type: "text", text: "round trip" }];
			const encrypted = e2ee.encryptPayloadForSession("session-rt", original);

			mockDecryptPayload.mockReturnValueOnce(original);
			mockIsEncryptedPayload.mockReturnValueOnce(true);

			const event = makeEvent("session-rt", encrypted);
			const decrypted = e2ee.decryptEvent(event);

			expect(decrypted.payload).toEqual(original);
		});
	});
});
