import {
	type CryptoKeyPair,
	createSignedToken,
	decryptPayload,
	deriveAuthKeyPair,
	deriveContentKeyPair,
	type EncryptedPayload,
	encryptPayload,
	generateDEK,
	generateMasterSecret,
	getSodium,
	initCrypto,
	isEncryptedPayload,
	unwrapDEK,
	verifySignedToken,
	wrapDEK,
} from "@mobvibe/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
	await initCrypto();
});

describe("key derivation", () => {
	it("derives deterministic auth keypair from master secret", () => {
		const master = generateMasterSecret();
		const kp1 = deriveAuthKeyPair(master);
		const kp2 = deriveAuthKeyPair(master);
		expect(kp1.publicKey).toEqual(kp2.publicKey);
		expect(kp1.secretKey).toEqual(kp2.secretKey);
	});

	it("derives deterministic content keypair from master secret", () => {
		const master = generateMasterSecret();
		const kp1 = deriveContentKeyPair(master);
		const kp2 = deriveContentKeyPair(master);
		expect(kp1.publicKey).toEqual(kp2.publicKey);
		expect(kp1.secretKey).toEqual(kp2.secretKey);
	});

	it("auth and content keypairs are different", () => {
		const master = generateMasterSecret();
		const auth = deriveAuthKeyPair(master);
		const content = deriveContentKeyPair(master);
		expect(auth.publicKey).not.toEqual(content.publicKey);
		expect(auth.secretKey).not.toEqual(content.secretKey);
	});
});

describe("encrypt/decrypt (secretbox)", () => {
	it("round-trips payload through encrypt and decrypt", () => {
		const dek = generateDEK();
		const original = { message: "hello world", nested: { a: 1 } };
		const encrypted = encryptPayload(original, dek);
		expect(encrypted.t).toBe("encrypted");
		expect(typeof encrypted.c).toBe("string");

		const decrypted = decryptPayload(encrypted, dek);
		expect(decrypted).toEqual(original);
	});

	it("detects ciphertext tampering", () => {
		const dek = generateDEK();
		const encrypted = encryptPayload({ secret: "data" }, dek);

		const sodium = getSodium();
		const raw = sodium.from_base64(
			encrypted.c,
			sodium.base64_variants.ORIGINAL,
		);
		// Flip a byte in the ciphertext (after the nonce)
		raw[raw.length - 1] ^= 0xff;
		const tampered: EncryptedPayload = {
			t: "encrypted",
			c: sodium.to_base64(raw, sodium.base64_variants.ORIGINAL),
		};

		expect(() => decryptPayload(tampered, dek)).toThrow();
	});
});

describe("isEncryptedPayload", () => {
	it("identifies encrypted payload", () => {
		const dek = generateDEK();
		const encrypted = encryptPayload({ a: 1 }, dek);
		expect(isEncryptedPayload(encrypted)).toBe(true);
	});

	it("rejects plain objects", () => {
		expect(isEncryptedPayload({ message: "hello" })).toBe(false);
		expect(isEncryptedPayload(null)).toBe(false);
		expect(isEncryptedPayload("string")).toBe(false);
		expect(isEncryptedPayload({ t: "other", c: "data" })).toBe(false);
	});
});

describe("DEK wrap/unwrap (box_seal)", () => {
	it("round-trips DEK through wrap and unwrap", () => {
		const master = generateMasterSecret();
		const content = deriveContentKeyPair(master);
		const dek = generateDEK();

		const wrapped = wrapDEK(dek, content.publicKey);
		expect(typeof wrapped).toBe("string");

		const unwrapped = unwrapDEK(wrapped, content.publicKey, content.secretKey);
		expect(unwrapped).toEqual(dek);
	});

	it("fails to unwrap with wrong key", () => {
		const master1 = generateMasterSecret();
		const master2 = generateMasterSecret();
		const content1 = deriveContentKeyPair(master1);
		const content2 = deriveContentKeyPair(master2);
		const dek = generateDEK();

		const wrapped = wrapDEK(dek, content1.publicKey);
		expect(() =>
			unwrapDEK(wrapped, content2.publicKey, content2.secretKey),
		).toThrow();
	});
});

describe("sign/verify token", () => {
	it("round-trips through create and verify", () => {
		const master = generateMasterSecret();
		const auth = deriveAuthKeyPair(master);

		const token = createSignedToken(auth);
		const result = verifySignedToken(token, 5 * 60 * 1000);
		expect(result).not.toBeNull();
		expect(result!.publicKey).toBe(token.payload.publicKey);
	});

	it("returns null for expired token", () => {
		const master = generateMasterSecret();
		const auth = deriveAuthKeyPair(master);

		const token = createSignedToken(auth);
		// Set timestamp to 10 minutes ago
		const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		const sodium = getSodium();
		const tamperedPayload = { ...token.payload, timestamp: oldTime };
		// Re-sign with the old timestamp so the signature is valid
		const payloadBytes = sodium.from_string(JSON.stringify(tamperedPayload));
		const sig = sodium.crypto_sign_detached(payloadBytes, auth.secretKey);
		const expiredToken = {
			payload: tamperedPayload,
			signature: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL),
		};

		const result = verifySignedToken(expiredToken, 5 * 60 * 1000);
		expect(result).toBeNull();
	});

	it("returns null for invalid signature", () => {
		const master = generateMasterSecret();
		const auth = deriveAuthKeyPair(master);

		const token = createSignedToken(auth);
		// Corrupt the signature
		const sodium = getSodium();
		const sigBytes = sodium.from_base64(
			token.signature,
			sodium.base64_variants.ORIGINAL,
		);
		sigBytes[0] ^= 0xff;
		const badToken = {
			...token,
			signature: sodium.to_base64(sigBytes, sodium.base64_variants.ORIGINAL),
		};

		const result = verifySignedToken(badToken, 5 * 60 * 1000);
		expect(result).toBeNull();
	});
});
