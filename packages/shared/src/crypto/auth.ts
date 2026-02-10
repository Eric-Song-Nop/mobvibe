import { getSodium } from "./init.js";
import type { CryptoKeyPair, SignedAuthToken } from "./types.js";

export function createSignedToken(authKeyPair: CryptoKeyPair): SignedAuthToken {
	const sodium = getSodium();
	const payload = {
		publicKey: sodium.to_base64(
			authKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		),
		timestamp: new Date().toISOString(),
	};
	const payloadBytes = sodium.from_string(JSON.stringify(payload));
	const signature = sodium.crypto_sign_detached(
		payloadBytes,
		authKeyPair.secretKey,
	);
	return {
		payload,
		signature: sodium.to_base64(signature, sodium.base64_variants.ORIGINAL),
	};
}

export function verifySignedToken(
	token: SignedAuthToken,
	maxAgeMs = 5 * 60 * 1000,
): { publicKey: string } | null {
	const sodium = getSodium();
	try {
		const tokenTime = new Date(token.payload.timestamp).getTime();
		if (Number.isNaN(tokenTime)) return null;
		if (Math.abs(Date.now() - tokenTime) > maxAgeMs) return null;

		const payloadBytes = sodium.from_string(JSON.stringify(token.payload));
		const signature = sodium.from_base64(
			token.signature,
			sodium.base64_variants.ORIGINAL,
		);
		const publicKey = sodium.from_base64(
			token.payload.publicKey,
			sodium.base64_variants.ORIGINAL,
		);
		const valid = sodium.crypto_sign_verify_detached(
			signature,
			payloadBytes,
			publicKey,
		);
		if (!valid) return null;

		return { publicKey: token.payload.publicKey };
	} catch {
		return null;
	}
}
