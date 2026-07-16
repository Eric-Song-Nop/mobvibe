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
	unwrapDEK,
	wrapDEK,
} from "@mobvibe/shared";

type CliCryptoServiceOptions = {
	contentEncryptionEnabled?: boolean;
};

export class CliCryptoService {
	readonly authKeyPair: CryptoKeyPair;
	readonly contentEncryptionEnabled: boolean;
	private contentKeyPair: CryptoKeyPair;
	private sessionDeks = new Map<string, Uint8Array>();
	private wrappedDekCache = new Map<string, string>();
	private revisionDeks = new Map<string, Uint8Array>();
	private revisionWrappedDekCache = new Map<string, string>();

	constructor(masterSecret: Uint8Array, options?: CliCryptoServiceOptions) {
		this.authKeyPair = deriveAuthKeyPair(masterSecret);
		this.contentEncryptionEnabled = options?.contentEncryptionEnabled !== false;
		this.contentKeyPair = deriveContentKeyPair(masterSecret);
	}

	/**
	 * Initialize a DEK for a session. Generates a random DEK and wraps it
	 * with the content public key.
	 */
	initSessionDek(
		sessionId: string,
		revision?: number,
	): {
		dek: Uint8Array;
		wrappedDek: string | null;
	} {
		if (!this.contentEncryptionEnabled || !this.contentKeyPair) {
			return { dek: new Uint8Array(), wrappedDek: null };
		}

		const dek = generateDEK();
		const wrappedDek = wrapDEK(dek, this.contentKeyPair.publicKey);
		this.sessionDeks.set(sessionId, dek);
		this.wrappedDekCache.set(sessionId, wrappedDek);
		if (revision !== undefined) {
			const key = this.revisionKey(sessionId, revision);
			this.revisionDeks.set(key, dek);
			this.revisionWrappedDekCache.set(key, wrappedDek);
		}
		return { dek, wrappedDek };
	}

	/**
	 * Set an existing DEK for a session (e.g., loaded from WAL).
	 */
	setSessionDek(sessionId: string, dek: Uint8Array, revision?: number): void {
		if (!this.contentEncryptionEnabled || !this.contentKeyPair) {
			return;
		}
		const wrappedDek = wrapDEK(dek, this.contentKeyPair.publicKey);
		this.sessionDeks.set(sessionId, dek);
		this.wrappedDekCache.set(sessionId, wrappedDek);
		if (revision !== undefined) {
			const key = this.revisionKey(sessionId, revision);
			this.revisionDeks.set(key, dek);
			this.revisionWrappedDekCache.set(key, wrappedDek);
		}
	}

	/**
	 * Recover a revision DEK from its sealed representation. The sealing keypair
	 * is deterministically derived from the existing CLI master secret.
	 */
	restoreSessionDek(
		sessionId: string,
		revision: number,
		wrappedDek: string,
	): Uint8Array | null {
		if (!this.contentEncryptionEnabled || !this.contentKeyPair) {
			return null;
		}
		const dek = unwrapDEK(
			wrappedDek,
			this.contentKeyPair.publicKey,
			this.contentKeyPair.secretKey,
		);
		const key = this.revisionKey(sessionId, revision);
		this.revisionDeks.set(key, dek);
		this.revisionWrappedDekCache.set(key, wrappedDek);
		this.sessionDeks.set(sessionId, dek);
		this.wrappedDekCache.set(sessionId, wrappedDek);
		return dek;
	}

	/**
	 * Encrypt a session event's payload in place.
	 * Returns a new event with the payload replaced by an EncryptedPayload.
	 */
	encryptEvent(event: SessionEvent): SessionEvent {
		if (!this.contentEncryptionEnabled) {
			return event;
		}
		const dek =
			this.revisionDeks.get(
				this.revisionKey(event.sessionId, event.revision),
			) ?? this.sessionDeks.get(event.sessionId);
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
	getWrappedDek(sessionId: string, revision?: number): string | null {
		if (revision !== undefined) {
			return (
				this.revisionWrappedDekCache.get(
					this.revisionKey(sessionId, revision),
				) ?? null
			);
		}
		return this.wrappedDekCache.get(sessionId) ?? null;
	}

	/**
	 * Get the base64-encoded auth public key.
	 */
	getAuthPublicKeyBase64(): string {
		return uint8ToBase64(this.authKeyPair.publicKey);
	}

	/** A stable public identity for binding local durable state to this key. */
	getKeyIdentity(): string {
		return `ed25519:${this.getAuthPublicKeyBase64()}`;
	}

	/** Validate a legacy sealed key without caching or exposing its plaintext. */
	canUnwrapDek(wrappedDek: string): boolean {
		try {
			unwrapDEK(
				wrappedDek,
				this.contentKeyPair.publicKey,
				this.contentKeyPair.secretKey,
			);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get the DEK for a session, or null if not initialized.
	 */
	getDek(sessionId: string, revision?: number): Uint8Array | null {
		if (revision !== undefined) {
			return (
				this.revisionDeks.get(this.revisionKey(sessionId, revision)) ?? null
			);
		}
		return this.sessionDeks.get(sessionId) ?? null;
	}

	private revisionKey(sessionId: string, revision: number): string {
		return `${sessionId}\u0000${revision}`;
	}

	/**
	 * Decrypt an encrypted payload for a session.
	 * Returns the decrypted data or throws if no DEK available.
	 */
	decryptPayloadForSession(
		encrypted: EncryptedPayload,
		sessionId: string,
	): unknown {
		if (!this.contentEncryptionEnabled) {
			return encrypted;
		}
		const dek = this.sessionDeks.get(sessionId);
		if (!dek) throw new Error("No DEK for session");
		return decryptPayload(encrypted, dek);
	}

	/**
	 * Decrypt RPC payload if encrypted. Returns original data if not encrypted
	 * or no DEK available.
	 */
	decryptRpcPayload<T>(sessionId: string, data: unknown): T {
		if (!this.contentEncryptionEnabled) return data as T;
		if (!isEncryptedPayload(data)) return data as T;
		const dek = this.sessionDeks.get(sessionId);
		if (!dek) return data as T;
		return decryptPayload(data, dek) as T;
	}
}
