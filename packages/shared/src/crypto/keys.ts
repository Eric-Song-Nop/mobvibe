import { blake2b } from "@noble/hashes/blake2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import nacl from "tweetnacl";
import { ensureCryptoReady } from "./init.js";
import type { CryptoKeyPair } from "./types.js";

export function generateMasterSecret(): Uint8Array {
	ensureCryptoReady();
	return nacl.randomBytes(32);
}

/**
 * Derives a subkey using BLAKE2b with salt + personalization.
 * Matches libsodium's crypto_kdf_derive_from_key exactly:
 *   - salt = subkeyId as LE uint64 + 8 zero bytes (16 bytes total)
 *   - personalization = ctx (8 ASCII bytes) + 8 zero bytes (16 bytes total)
 *   - BLAKE2b keyed hash with empty message
 */
function kdfDeriveFromKey(
	subkeyLen: number,
	subkeyId: number,
	ctx: string,
	key: Uint8Array,
): Uint8Array {
	const salt = new Uint8Array(16);
	const view = new DataView(salt.buffer);
	// subkeyId as little-endian uint64 (we use two 32-bit writes for compatibility)
	view.setUint32(0, subkeyId, true);
	view.setUint32(4, 0, true);

	const personal = new Uint8Array(16);
	const encoder = new TextEncoder();
	personal.set(encoder.encode(ctx).subarray(0, 8));

	return blake2b(new Uint8Array(0), {
		dkLen: subkeyLen,
		key,
		salt,
		personalization: personal,
	});
}

export function deriveAuthKeyPair(masterSecret: Uint8Array): CryptoKeyPair {
	ensureCryptoReady();
	const seed = kdfDeriveFromKey(32, 1, "mobvauth", masterSecret);
	const { publicKey, secretKey } = nacl.sign.keyPair.fromSeed(seed);
	return { publicKey, secretKey };
}

export function deriveContentKeyPair(masterSecret: Uint8Array): CryptoKeyPair {
	ensureCryptoReady();
	const seed = kdfDeriveFromKey(32, 2, "mobvcont", masterSecret);
	// Match libsodium's crypto_box_seed_keypair: SHA-512(seed)[0..31] as X25519 sk
	const hash = sha512(seed);
	const sk = hash.slice(0, 32);
	const pk = nacl.scalarMult.base(sk);
	return { publicKey: pk, secretKey: sk };
}

export function generateDEK(): Uint8Array {
	ensureCryptoReady();
	return nacl.randomBytes(32);
}

export function wrapDEK(dek: Uint8Array, contentPubKey: Uint8Array): string {
	ensureCryptoReady();
	const sealed = cryptoBoxSeal(dek, contentPubKey);
	return uint8ToBase64(sealed);
}

export function unwrapDEK(
	wrappedBase64: string,
	contentPubKey: Uint8Array,
	contentSecKey: Uint8Array,
): Uint8Array {
	ensureCryptoReady();
	const sealed = base64ToUint8(wrappedBase64);
	const result = cryptoBoxSealOpen(sealed, contentPubKey, contentSecKey);
	if (!result) {
		throw new Error("Failed to unwrap DEK: decryption failed");
	}
	return result;
}

/**
 * Sealed box encryption — matches libsodium's crypto_box_seal exactly:
 *   - Generate ephemeral X25519 keypair
 *   - nonce = BLAKE2b(ephemeral_pk || recipient_pk, dkLen=24, no key)
 *   - output = ephemeral_pk || crypto_box(msg, nonce, recipient_pk, ephemeral_sk)
 */
function cryptoBoxSeal(
	message: Uint8Array,
	recipientPk: Uint8Array,
): Uint8Array {
	const ephemeral = nacl.box.keyPair();
	const nonce = sealNonce(ephemeral.publicKey, recipientPk);
	const encrypted = nacl.box(message, nonce, recipientPk, ephemeral.secretKey);
	const sealed = new Uint8Array(32 + encrypted.length);
	sealed.set(ephemeral.publicKey, 0);
	sealed.set(encrypted, 32);
	return sealed;
}

function cryptoBoxSealOpen(
	sealed: Uint8Array,
	recipientPk: Uint8Array,
	recipientSk: Uint8Array,
): Uint8Array | null {
	if (sealed.length < 48) return null;
	const ephemeralPk = sealed.subarray(0, 32);
	const encrypted = sealed.subarray(32);
	const nonce = sealNonce(ephemeralPk, recipientPk);
	return nacl.box.open(encrypted, nonce, ephemeralPk, recipientSk);
}

function sealNonce(
	ephemeralPk: Uint8Array,
	recipientPk: Uint8Array,
): Uint8Array {
	const input = new Uint8Array(64);
	input.set(ephemeralPk, 0);
	input.set(recipientPk, 32);
	return blake2b(input, { dkLen: 24 });
}

// --- Base64 helpers (standard/original variant, matching libsodium ORIGINAL) ---

function uint8ToBase64(buf: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < buf.length; i++) {
		binary += String.fromCharCode(buf[i]);
	}
	return btoa(binary);
}

function base64ToUint8(str: string): Uint8Array {
	const binary = atob(str);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export { uint8ToBase64, base64ToUint8 };
