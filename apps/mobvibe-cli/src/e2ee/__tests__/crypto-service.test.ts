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
	test("initSessionDek returns DEK and wrapped DEK string", () => {
		const { dek, wrappedDek } = service.initSessionDek("session-1");
		expect(dek).toBeInstanceOf(Uint8Array);
		expect(dek.length).toBe(32);
		expect(typeof wrappedDek).toBe("string");
		expect(wrappedDek.length).toBeGreaterThan(0);
	});

	test("getWrappedDek returns cached value after init", () => {
		const { wrappedDek } = service.initSessionDek("session-cache");
		const cached = service.getWrappedDek("session-cache");
		expect(cached).toBe(wrappedDek);
	});

	test("getWrappedDek returns cached value after setSessionDek", () => {
		const sodium = getSodium();
		const dek = sodium.randombytes_buf(32);
		service.setSessionDek("session-set", dek);

		const wrapped = service.getWrappedDek("session-set");
		expect(wrapped).not.toBeNull();
		expect(typeof wrapped).toBe("string");

		// Verify it can be unwrapped
		const contentKp = deriveContentKeyPair(masterSecret);
		const unwrapped = unwrapDEK(
			wrapped!,
			contentKp.publicKey,
			contentKp.secretKey,
		);
		expect(unwrapped).toEqual(dek);
	});

	test("getWrappedDek returns null for unknown session", () => {
		expect(service.getWrappedDek("unknown-session")).toBeNull();
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
		const { wrappedDek } = service.initSessionDek("session-rt");
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
		const dek = unwrapDEK(wrappedDek, contentKp.publicKey, contentKp.secretKey);
		const decrypted = decryptPayload(
			encrypted.payload as { t: "encrypted"; c: string },
			dek,
		);
		expect(decrypted).toEqual(originalPayload);
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
});
