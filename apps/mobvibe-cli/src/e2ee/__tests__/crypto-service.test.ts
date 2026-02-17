import { beforeAll, describe, expect, test } from "bun:test";
import {
	decryptPayload,
	deriveContentKeyPair,
	encryptPayload,
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

	test("getDek returns DEK for initialized session", () => {
		const { dek } = service.initSessionDek("session-getdek");
		const retrieved = service.getDek("session-getdek");
		expect(retrieved).toEqual(dek);
	});

	test("getDek returns null for unknown session", () => {
		expect(service.getDek("unknown-session")).toBeNull();
	});

	describe("bidirectional encryption", () => {
		test("decryptPayloadForSession decrypts encrypted data", () => {
			const { dek } = service.initSessionDek("session-decrypt");
			const original = [{ type: "text", text: "hello" }];
			const encrypted = encryptPayload(original, dek);

			const decrypted = service.decryptPayloadForSession(
				encrypted,
				"session-decrypt",
			);
			expect(decrypted).toEqual(original);
		});

		test("decryptPayloadForSession throws when no DEK", () => {
			const encrypted = encryptPayload(
				[{ type: "text", text: "hello" }],
				new Uint8Array(32),
			);
			expect(() =>
				service.decryptPayloadForSession(encrypted, "unknown-session"),
			).toThrow("No DEK for session");
		});

		test("decryptRpcPayload returns original when not encrypted", () => {
			service.initSessionDek("session-rpc");
			const original = [{ type: "text", text: "plain" }];
			const result = service.decryptRpcPayload("session-rpc", original);
			expect(result).toBe(original);
		});

		test("decryptRpcPayload returns original when no DEK", () => {
			const encrypted = { t: "encrypted" as const, c: "some-data" };
			const result = service.decryptRpcPayload("unknown-session", encrypted);
			expect(result).toBe(encrypted);
		});

		test("decryptRpcPayload decrypts encrypted payload", () => {
			const { dek } = service.initSessionDek("session-rpc-decrypt");
			const original = [{ type: "text", text: "secret message" }];
			const encrypted = encryptPayload(original, dek);

			const result = service.decryptRpcPayload<typeof original>(
				"session-rpc-decrypt",
				encrypted,
			);
			expect(result).toEqual(original);
		});

		test("round-trip: encrypt from WebUI, decrypt on CLI", () => {
			const { dek, wrappedDek } = service.initSessionDek("session-bidi");

			// Simulate WebUI: unwrap DEK then encrypt prompt
			const contentKp = deriveContentKeyPair(masterSecret);
			const webuiDek = unwrapDEK(
				wrappedDek,
				contentKp.publicKey,
				contentKp.secretKey,
			);
			expect(webuiDek).toEqual(dek);

			const originalPrompt = [{ type: "text", text: "user message" } as const];
			const encrypted = encryptPayload(originalPrompt, webuiDek);

			// CLI decrypts the prompt
			const decrypted = service.decryptRpcPayload<typeof originalPrompt>(
				"session-bidi",
				encrypted,
			);
			expect(decrypted).toEqual(originalPrompt);
		});
	});
});
