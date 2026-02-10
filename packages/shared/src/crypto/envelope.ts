import { getSodium } from "./init.js";
import type { EncryptedPayload } from "./types.js";

export function encryptPayload(
	payload: unknown,
	dek: Uint8Array,
): EncryptedPayload {
	const sodium = getSodium();
	const plaintext = sodium.from_string(JSON.stringify(payload));
	const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
	const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, dek);
	const combined = new Uint8Array(nonce.length + ciphertext.length);
	combined.set(nonce);
	combined.set(ciphertext, nonce.length);
	return {
		t: "encrypted",
		c: sodium.to_base64(combined, sodium.base64_variants.ORIGINAL),
	};
}

export function decryptPayload(
	encrypted: EncryptedPayload,
	dek: Uint8Array,
): unknown {
	const sodium = getSodium();
	const combined = sodium.from_base64(
		encrypted.c,
		sodium.base64_variants.ORIGINAL,
	);
	const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
	const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
	const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, dek);
	return JSON.parse(sodium.to_string(plaintext));
}

export function isEncryptedPayload(
	payload: unknown,
): payload is EncryptedPayload {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"t" in payload &&
		(payload as Record<string, unknown>).t === "encrypted" &&
		"c" in payload &&
		typeof (payload as Record<string, unknown>).c === "string"
	);
}
