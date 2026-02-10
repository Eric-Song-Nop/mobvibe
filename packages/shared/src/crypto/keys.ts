import { getSodium } from "./init.js";
import type { CryptoKeyPair } from "./types.js";

export function generateMasterSecret(): Uint8Array {
	const sodium = getSodium();
	return sodium.randombytes_buf(32);
}

export function deriveAuthKeyPair(masterSecret: Uint8Array): CryptoKeyPair {
	const sodium = getSodium();
	const seed = sodium.crypto_kdf_derive_from_key(
		32,
		1,
		"mobvauth",
		masterSecret,
	);
	const { publicKey, privateKey } = sodium.crypto_sign_seed_keypair(seed);
	return { publicKey, secretKey: privateKey };
}

export function deriveContentKeyPair(masterSecret: Uint8Array): CryptoKeyPair {
	const sodium = getSodium();
	const seed = sodium.crypto_kdf_derive_from_key(
		32,
		2,
		"mobvcont",
		masterSecret,
	);
	const { publicKey, privateKey } = sodium.crypto_box_seed_keypair(seed);
	return { publicKey, secretKey: privateKey };
}

export function generateDEK(): Uint8Array {
	const sodium = getSodium();
	return sodium.randombytes_buf(32);
}

export function wrapDEK(dek: Uint8Array, contentPubKey: Uint8Array): string {
	const sodium = getSodium();
	const sealed = sodium.crypto_box_seal(dek, contentPubKey);
	return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

export function unwrapDEK(
	wrappedBase64: string,
	contentPubKey: Uint8Array,
	contentSecKey: Uint8Array,
): Uint8Array {
	const sodium = getSodium();
	const sealed = sodium.from_base64(
		wrappedBase64,
		sodium.base64_variants.ORIGINAL,
	);
	return sodium.crypto_box_seal_open(sealed, contentPubKey, contentSecKey);
}
