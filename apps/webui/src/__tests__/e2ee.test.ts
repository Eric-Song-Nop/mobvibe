import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@/lib/acp";

// Mock @mobvibe/core crypto functions (libsodium doesn't work in jsdom)
const mockInitCrypto = vi.fn().mockResolvedValue(undefined);
const mockGetSodium = vi.fn(() => ({
	from_base64: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
	to_base64: (buf: Uint8Array) => Buffer.from(buf).toString("base64"),
	base64_variants: { ORIGINAL: 0 },
	randombytes_buf: (len: number) => new Uint8Array(len).fill(42),
}));
const mockDeriveContentKeyPair = vi.fn(() => ({
	publicKey: new Uint8Array([1, 2, 3]),
	secretKey: new Uint8Array([4, 5, 6]),
}));
const mockDeriveAuthKeyPair = vi.fn(() => ({
	publicKey: new Uint8Array([7, 8, 9]),
	secretKey: new Uint8Array([10, 11, 12]),
}));
const mockGenerateMasterSecret = vi.fn(() => new Uint8Array(32).fill(42));
const mockUnwrapDEK = vi.fn(() => new Uint8Array([10, 20, 30]));
const mockDecryptPayload = vi.fn((encrypted: { t: string; c: string }) =>
	JSON.parse(atob(encrypted.c)),
);
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
	generateMasterSecret: mockGenerateMasterSecret,
	unwrapDEK: mockUnwrapDEK,
	decryptPayload: mockDecryptPayload,
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

// Import after mocks are set up
const { e2ee } = await import("@/lib/e2ee");

describe("E2EEManager", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await e2ee.clearSecret();
	});

	it("isEnabled() returns false initially", () => {
		expect(e2ee.isEnabled()).toBe(false);
	});

	it("setPairedSecret makes isEnabled() return true", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		expect(e2ee.isEnabled()).toBe(true);
		expect(mockInitCrypto).toHaveBeenCalled();
		expect(mockDeriveContentKeyPair).toHaveBeenCalled();
	});

	it("clearSecret makes isEnabled() return false and clears localStorage", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		expect(e2ee.isEnabled()).toBe(true);

		await e2ee.clearSecret();
		expect(e2ee.isEnabled()).toBe(false);
		expect(localStorage.getItem("mobvibe_e2ee_master_secret")).toBeNull();
		expect(localStorage.getItem("mobvibe_e2ee_device_id")).toBeNull();
	});

	it("unwrapSessionDek returns false when not enabled", () => {
		expect(e2ee.unwrapSessionDek("session-1", "wrapped-dek")).toBe(false);
	});

	it("unwrapSessionDek returns true after pairing", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		const result = e2ee.unwrapSessionDek("session-1", "wrapped-dek-base64");
		expect(result).toBe(true);
		expect(mockUnwrapDEK).toHaveBeenCalledWith(
			"wrapped-dek-base64",
			expect.any(Uint8Array),
			expect.any(Uint8Array),
		);
	});

	it("unwrapFromSession handles legacy wrappedDek", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		const result = e2ee.unwrapFromSession("session-1", "wrapped-dek-base64");
		expect(result).toBe(true);
	});

	it("unwrapFromSession handles multi-device wrappedDeks", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		const result = e2ee.unwrapFromSession("session-2", undefined, {
			"device-a": "wrapped-for-a",
			"device-b": "wrapped-for-b",
		});
		expect(result).toBe(true);
		// Should try all entries
		expect(mockUnwrapDEK).toHaveBeenCalled();
	});

	it("unwrapFromSession prefers wrappedDeks over wrappedDek", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		const result = e2ee.unwrapFromSession("session-3", "legacy-wrapped", {
			"device-a": "multi-wrapped",
		});
		expect(result).toBe(true);
		// Should try multi-device first
		expect(mockUnwrapDEK).toHaveBeenCalledWith(
			"multi-wrapped",
			expect.any(Uint8Array),
			expect.any(Uint8Array),
		);
	});

	it("unwrapFromSession returns false when nothing provided", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		const result = e2ee.unwrapFromSession("session-4");
		expect(result).toBe(false);
	});

	it("decryptEvent passes through non-encrypted payloads unchanged", () => {
		const event = makeEvent("session-1", { text: "plain" });
		const result = e2ee.decryptEvent(event);
		expect(result).toBe(event);
	});

	it("decryptEvent decrypts encrypted payloads", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
		e2ee.unwrapSessionDek("session-1", "wrapped-dek");

		const original = { text: "decrypted" };
		const encrypted = { t: "encrypted", c: btoa(JSON.stringify(original)) };
		const event = makeEvent("session-1", encrypted);

		const result = e2ee.decryptEvent(event);
		expect(result.payload).toEqual(original);
		expect(mockDecryptPayload).toHaveBeenCalled();
	});

	it("decryptEvent logs warning on failure", async () => {
		await e2ee.setPairedSecret(btoa("test-secret"));
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
		expect(result).toEqual(event); // Returns original on failure
		expect(warnSpy).toHaveBeenCalledWith(
			"[E2EE] Failed to decrypt event",
			"session-1",
			expect.any(Error),
		);
		warnSpy.mockRestore();
	});

	it("loadFromStorage restores state from localStorage", async () => {
		const secret = btoa("stored-secret");
		localStorage.setItem("mobvibe_e2ee_master_secret", secret);

		const result = await e2ee.loadFromStorage();
		expect(result).toBe(true);
		expect(e2ee.isEnabled()).toBe(true);
	});

	it("loadFromStorage returns false when no stored secret", async () => {
		const result = await e2ee.loadFromStorage();
		expect(result).toBe(false);
		expect(e2ee.isEnabled()).toBe(false);
	});

	it("getDeviceId returns null initially", () => {
		expect(e2ee.getDeviceId()).toBeNull();
	});

	it("loadFromStorage restores device ID from localStorage", async () => {
		const secret = btoa("stored-secret");
		localStorage.setItem("mobvibe_e2ee_master_secret", secret);
		localStorage.setItem("mobvibe_e2ee_device_id", "test-device-id");

		const result = await e2ee.loadFromStorage();
		expect(result).toBe(true);
		expect(e2ee.getDeviceId()).toBe("test-device-id");
	});
});
