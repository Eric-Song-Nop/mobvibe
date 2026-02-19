import nacl from "tweetnacl";
import { ensureCryptoReady } from "./init.js";
import { base64ToUint8, uint8ToBase64 } from "./keys.js";
import type { CryptoKeyPair, SignedAuthToken } from "./types.js";

export function createSignedToken(authKeyPair: CryptoKeyPair): SignedAuthToken {
	ensureCryptoReady();
	const payload = {
		publicKey: uint8ToBase64(authKeyPair.publicKey),
		timestamp: new Date().toISOString(),
	};
	const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
	const signature = nacl.sign.detached(payloadBytes, authKeyPair.secretKey);
	return {
		payload,
		signature: uint8ToBase64(signature),
	};
}

export function verifySignedToken(
	token: SignedAuthToken,
	maxAgeMs = 5 * 60 * 1000,
): { publicKey: string } | null {
	ensureCryptoReady();
	try {
		const tokenTime = new Date(token.payload.timestamp).getTime();
		if (Number.isNaN(tokenTime)) return null;
		if (Math.abs(Date.now() - tokenTime) > maxAgeMs) return null;

		const payloadBytes = new TextEncoder().encode(
			JSON.stringify(token.payload),
		);
		const signature = base64ToUint8(token.signature);
		const publicKey = base64ToUint8(token.payload.publicKey);
		const valid = nacl.sign.detached.verify(payloadBytes, signature, publicKey);
		if (!valid) return null;

		return { publicKey: token.payload.publicKey };
	} catch {
		return null;
	}
}
