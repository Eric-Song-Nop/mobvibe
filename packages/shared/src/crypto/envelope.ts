import nacl from "tweetnacl";
import { ensureCryptoReady } from "./init.js";
import { base64ToUint8, uint8ToBase64 } from "./keys.js";
import type { EncryptedPayload } from "./types.js";

const NONCE_BYTES = 24; // crypto_secretbox_NONCEBYTES

export function encryptPayload(
	payload: unknown,
	dek: Uint8Array,
): EncryptedPayload {
	ensureCryptoReady();
	const plaintext = new TextEncoder().encode(JSON.stringify(payload));
	const nonce = nacl.randomBytes(NONCE_BYTES);
	const ciphertext = nacl.secretbox(plaintext, nonce, dek);
	const combined = new Uint8Array(nonce.length + ciphertext.length);
	combined.set(nonce);
	combined.set(ciphertext, nonce.length);
	return {
		t: "encrypted",
		c: uint8ToBase64(combined),
	};
}

export function decryptPayload(
	encrypted: EncryptedPayload,
	dek: Uint8Array,
): unknown {
	ensureCryptoReady();
	const combined = base64ToUint8(encrypted.c);
	const nonce = combined.slice(0, NONCE_BYTES);
	const ciphertext = combined.slice(NONCE_BYTES);
	const plaintext = nacl.secretbox.open(ciphertext, nonce, dek);
	if (!plaintext) {
		throw new Error("Decryption failed: invalid ciphertext or key");
	}
	return JSON.parse(new TextDecoder().decode(plaintext));
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
