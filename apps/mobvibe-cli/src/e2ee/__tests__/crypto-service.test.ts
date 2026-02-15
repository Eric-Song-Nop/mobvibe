import { beforeAll, describe, expect, test } from "bun:test";
import {
	decryptPayload,
	deriveContentKeyPair,
	generateMasterSecret,
	getSodium,
	initCrypto,
	isEncryptedPayload,
	unwrapDEK,
} from "@mobvibe/shared";
import { CliCryptoService } from "../crypto-service.js";

let masterSecret: Uint8Array;
let service: CliCryptoService;

beforeAll(async () => {
	await initCrypto();
	masterSecret = generateMasterSecret();
	service = new CliCryptoService(masterSecret);
});

describe("CliCryptoService", () => {
	test("initSessionDek returns DEK and wrappedDeks map", () => {
		const { dek, wrappedDeks } = service.initSessionDek("session-1");
		expect(dek).toBeInstanceOf(Uint8Array);
		expect(dek.length).toBe(32);
		expect(typeof wrappedDeks).toBe("object");
		// With no device content keys set, should use "self" fallback
		expect(Object.keys(wrappedDeks).length).toBeGreaterThan(0);
	});

	test("getWrappedDeks returns cached value after init", () => {
		const { wrappedDeks } = service.initSessionDek("session-cache");
		const cached = service.getWrappedDeks("session-cache");
		expect(cached).toEqual(wrappedDeks);
	});

	test("getWrappedDeks returns cached value after setSessionDek", () => {
		const sodium = getSodium();
		const dek = sodium.randombytes_buf(32);
		service.setSessionDek("session-set", dek);

		const wrappedDeks = service.getWrappedDeks("session-set");
		expect(wrappedDeks).not.toBeNull();
		// Fallback "self" key should be present
		expect(wrappedDeks!.self).toBeDefined();

		// Verify it can be unwrapped
		const contentKp = deriveContentKeyPair(masterSecret);
		const unwrapped = unwrapDEK(
			wrappedDeks!.self,
			contentKp.publicKey,
			contentKp.secretKey,
		);
		expect(unwrapped).toEqual(dek);
	});

	test("getWrappedDeks returns null for unknown session", () => {
		expect(service.getWrappedDeks("unknown-session")).toBeNull();
	});

	test("encryptEvent produces encrypted payload", () => {
		service.initSessionDek("session-enc");
		const event = {
			sessionId: "session-enc",
			machineId: "machine-1",
			revision: 1,
			seq: 1,
			kind: "user_message" as const,
			createdAt: new Date().toISOString(),
			payload: { text: "hello" },
		};

		const encrypted = service.encryptEvent(event);
		expect(isEncryptedPayload(encrypted.payload)).toBe(true);
		const ep = encrypted.payload as { t: string; c: string };
		expect(ep.t).toBe("encrypted");
		expect(typeof ep.c).toBe("string");
	});

	test("encrypt event round-trip: unwrap DEK + decrypt on WebUI side", () => {
		const { wrappedDeks } = service.initSessionDek("session-rt");
		const originalPayload = { text: "round trip test", count: 42 };
		const event = {
			sessionId: "session-rt",
			machineId: "machine-1",
			revision: 1,
			seq: 1,
			kind: "agent_message_chunk" as const,
			createdAt: new Date().toISOString(),
			payload: originalPayload,
		};

		const encrypted = service.encryptEvent(event);

		// Simulate WebUI side: unwrap DEK then decrypt
		const contentKp = deriveContentKeyPair(masterSecret);
		const selfWrapped = wrappedDeks.self;
		const dek = unwrapDEK(
			selfWrapped,
			contentKp.publicKey,
			contentKp.secretKey,
		);
		const decrypted = decryptPayload(
			encrypted.payload as { t: "encrypted"; c: string },
			dek,
		);
		expect(decrypted).toEqual(originalPayload);
	});

	test("multi-device wrapping: DEK wrapped for multiple devices", () => {
		const sodium = getSodium();

		// Create two extra "devices" with their own key pairs
		const secret2 = generateMasterSecret();
		const contentKp2 = deriveContentKeyPair(secret2);
		const secret3 = generateMasterSecret();
		const contentKp3 = deriveContentKeyPair(secret3);

		service.setDeviceContentKeys([
			{
				deviceId: "device-a",
				contentPublicKey: sodium.to_base64(
					contentKp2.publicKey,
					sodium.base64_variants.ORIGINAL,
				),
			},
			{
				deviceId: "device-b",
				contentPublicKey: sodium.to_base64(
					contentKp3.publicKey,
					sodium.base64_variants.ORIGINAL,
				),
			},
		]);

		const { wrappedDeks } = service.initSessionDek("session-multi");
		expect(wrappedDeks["device-a"]).toBeDefined();
		expect(wrappedDeks["device-b"]).toBeDefined();
		// "self" should NOT be present when device keys are set
		expect(wrappedDeks.self).toBeUndefined();

		// Device A can unwrap
		const dekA = unwrapDEK(
			wrappedDeks["device-a"],
			contentKp2.publicKey,
			contentKp2.secretKey,
		);
		// Device B can unwrap
		const dekB = unwrapDEK(
			wrappedDeks["device-b"],
			contentKp3.publicKey,
			contentKp3.secretKey,
		);
		// Both should get the same DEK
		expect(dekA).toEqual(dekB);
	});

	test("rewrapAllSessions re-wraps existing sessions for new devices", () => {
		const sodium = getSodium();

		// Reset device content keys
		service.setDeviceContentKeys([]);
		service.initSessionDek("session-rewrap");

		const before = service.getWrappedDeks("session-rewrap");
		expect(before!.self).toBeDefined();

		// Add a device and rewrap
		const newSecret = generateMasterSecret();
		const newKp = deriveContentKeyPair(newSecret);
		service.setDeviceContentKeys([
			{
				deviceId: "new-device",
				contentPublicKey: sodium.to_base64(
					newKp.publicKey,
					sodium.base64_variants.ORIGINAL,
				),
			},
		]);
		service.rewrapAllSessions();

		const after = service.getWrappedDeks("session-rewrap");
		expect(after!["new-device"]).toBeDefined();
		expect(after!.self).toBeUndefined();

		// Verify the new device can unwrap
		const dek = unwrapDEK(
			after!["new-device"],
			newKp.publicKey,
			newKp.secretKey,
		);
		expect(dek).toBeInstanceOf(Uint8Array);
		expect(dek.length).toBe(32);
	});

	test("encryptEvent passes through when no DEK exists", () => {
		const event = {
			sessionId: "session-no-dek",
			machineId: "machine-1",
			revision: 1,
			seq: 1,
			kind: "user_message" as const,
			createdAt: new Date().toISOString(),
			payload: { text: "plain" },
		};

		const result = service.encryptEvent(event);
		expect(result.payload).toEqual({ text: "plain" });
	});

	test("getAuthPublicKeyBase64 returns base64 string", () => {
		const pubKey = service.getAuthPublicKeyBase64();
		expect(typeof pubKey).toBe("string");
		expect(pubKey.length).toBeGreaterThan(0);
		// Should be valid base64
		const sodium = getSodium();
		const decoded = sodium.from_base64(pubKey, sodium.base64_variants.ORIGINAL);
		expect(decoded).toBeInstanceOf(Uint8Array);
	});

	test("getContentPublicKeyBase64 returns base64 string", () => {
		const pubKey = service.getContentPublicKeyBase64();
		expect(typeof pubKey).toBe("string");
		expect(pubKey.length).toBeGreaterThan(0);
		const sodium = getSodium();
		const decoded = sodium.from_base64(pubKey, sodium.base64_variants.ORIGINAL);
		expect(decoded).toBeInstanceOf(Uint8Array);
		expect(decoded.length).toBe(32);
	});
});
