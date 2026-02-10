import type { CryptoKeyPair, SessionEvent } from "@mobvibe/shared";
import {
	deriveAuthKeyPair,
	deriveContentKeyPair,
	encryptPayload,
	generateDEK,
	getSodium,
	wrapDEK,
} from "@mobvibe/shared";

export class CliCryptoService {
	readonly authKeyPair: CryptoKeyPair;
	private contentKeyPair: CryptoKeyPair;
	private sessionDeks = new Map<string, Uint8Array>();
	private wrappedDekCache = new Map<string, string>();

	constructor(masterSecret: Uint8Array) {
		this.authKeyPair = deriveAuthKeyPair(masterSecret);
		this.contentKeyPair = deriveContentKeyPair(masterSecret);
	}

	/**
	 * Initialize a DEK for a session. Generates a random DEK and wraps it
	 * with the content public key.
	 */
	initSessionDek(sessionId: string): {
		dek: Uint8Array;
		wrappedDek: string;
	} {
		const dek = generateDEK();
		const wrappedDek = wrapDEK(dek, this.contentKeyPair.publicKey);
		this.sessionDeks.set(sessionId, dek);
		this.wrappedDekCache.set(sessionId, wrappedDek);
		return { dek, wrappedDek };
	}

	/**
	 * Set an existing DEK for a session (e.g., loaded from WAL).
	 */
	setSessionDek(sessionId: string, dek: Uint8Array): void {
		this.sessionDeks.set(sessionId, dek);
		this.wrappedDekCache.set(
			sessionId,
			wrapDEK(dek, this.contentKeyPair.publicKey),
		);
	}

	/**
	 * Encrypt a session event's payload in place.
	 * Returns a new event with the payload replaced by an EncryptedPayload.
	 */
	encryptEvent(event: SessionEvent): SessionEvent {
		const dek = this.sessionDeks.get(event.sessionId);
		if (!dek) {
			// No DEK for this session — pass through unencrypted
			return event;
		}
		return {
			...event,
			payload: encryptPayload(event.payload, dek),
		};
	}

	/**
	 * Get the wrapped DEK for a session, or null if not initialized.
	 */
	getWrappedDek(sessionId: string): string | null {
		return this.wrappedDekCache.get(sessionId) ?? null;
	}

	/**
	 * Get the base64-encoded auth public key.
	 */
	getAuthPublicKeyBase64(): string {
		const sodium = getSodium();
		return sodium.to_base64(
			this.authKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		);
	}
}
