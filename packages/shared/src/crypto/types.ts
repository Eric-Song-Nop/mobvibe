export type EncryptedPayload = {
	t: "encrypted";
	c: string;
};

export type CryptoKeyPair = {
	publicKey: Uint8Array;
	secretKey: Uint8Array;
};

export type SignedAuthToken = {
	payload: {
		publicKey: string;
		timestamp: string;
	};
	signature: string;
};

/** Subset of libsodium-wrappers API used by our crypto module */
export interface SodiumLib {
	readonly ready: Promise<void>;
	readonly crypto_secretbox_NONCEBYTES: number;
	readonly base64_variants: {
		readonly ORIGINAL: number;
	};
	randombytes_buf(length: number): Uint8Array;
	crypto_kdf_derive_from_key(
		subkey_len: number,
		subkey_id: number,
		ctx: string,
		key: Uint8Array,
	): Uint8Array;
	crypto_sign_seed_keypair(seed: Uint8Array): {
		publicKey: Uint8Array;
		privateKey: Uint8Array;
		keyType: string;
	};
	crypto_box_seed_keypair(seed: Uint8Array): {
		publicKey: Uint8Array;
		privateKey: Uint8Array;
		keyType: string;
	};
	crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
	crypto_box_seal_open(
		ciphertext: Uint8Array,
		publicKey: Uint8Array,
		secretKey: Uint8Array,
	): Uint8Array;
	crypto_secretbox_easy(
		message: Uint8Array,
		nonce: Uint8Array,
		key: Uint8Array,
	): Uint8Array;
	crypto_secretbox_open_easy(
		ciphertext: Uint8Array,
		nonce: Uint8Array,
		key: Uint8Array,
	): Uint8Array;
	crypto_sign_detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
	crypto_sign_verify_detached(
		signature: Uint8Array,
		message: Uint8Array,
		publicKey: Uint8Array,
	): boolean;
	from_string(str: string): Uint8Array;
	to_string(buf: Uint8Array): string;
	to_base64(buf: Uint8Array, variant: number): string;
	from_base64(str: string, variant: number): Uint8Array;
}
