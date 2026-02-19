import type {
	CryptoKeyPair,
	EncryptedPayload,
	SessionEvent,
} from "@mobvibe/shared";
import {
	decryptPayload,
	deriveAuthKeyPair,
	deriveContentKeyPair,
	encryptPayload,
	generateDEK,
	isEncryptedPayload,
	uint8ToBase64,
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
		return uint8ToBase64(this.authKeyPair.publicKey);
	}

	/**
	 * Get the DEK for a session, or null if not initialized.
	 */
	getDek(sessionId: string): Uint8Array | null {
		return this.sessionDeks.get(sessionId) ?? null;
	}

	/**
	 * Decrypt an encrypted payload for a session.
	 * Returns the decrypted data or throws if no DEK available.
	 */
	decryptPayloadForSession(
		encrypted: EncryptedPayload,
		sessionId: string,
	): unknown {
		const dek = this.sessionDeks.get(sessionId);
		if (!dek) throw new Error("No DEK for session");
		return decryptPayload(encrypted, dek);
	}

	/**
	 * Decrypt RPC payload if encrypted. Returns original data if not encrypted
	 * or no DEK available.
	 */
	decryptRpcPayload<T>(sessionId: string, data: unknown): T {
		if (!isEncryptedPayload(data)) return data as T;
		const dek = this.sessionDeks.get(sessionId);
		if (!dek) return data as T;
		return decryptPayload(data, dek) as T;
	}
}
