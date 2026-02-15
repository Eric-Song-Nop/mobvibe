import type { CryptoKeyPair, SessionEvent } from "@mobvibe/shared";
import {
	deriveAuthKeyPair,
	deriveContentKeyPair,
	encryptPayload,
	generateDEK,
	getSodium,
	wrapDEK,
} from "@mobvibe/shared";

export type DeviceContentKey = {
	deviceId: string;
	contentPublicKey: string;
};

export class CliCryptoService {
	readonly authKeyPair: CryptoKeyPair;
	private contentKeyPair: CryptoKeyPair;
	private sessionDeks = new Map<string, Uint8Array>();
	/** Per-session map of deviceId → wrappedDek */
	private wrappedDeksCache = new Map<string, Record<string, string>>();
	/** Known device content keys for multi-device DEK wrapping */
	private deviceContentKeys: DeviceContentKey[] = [];

	constructor(masterSecret: Uint8Array) {
		this.authKeyPair = deriveAuthKeyPair(masterSecret);
		this.contentKeyPair = deriveContentKeyPair(masterSecret);
	}

	/**
	 * Update the set of known device content keys.
	 * Called after fetching from the gateway.
	 */
	setDeviceContentKeys(keys: DeviceContentKey[]): void {
		this.deviceContentKeys = keys;
	}

	/**
	 * Initialize a DEK for a session. Generates a random DEK and wraps it
	 * for all known device content keys (multi-device E2EE).
	 * Falls back to wrapping for own content key if no device keys are known.
	 */
	initSessionDek(sessionId: string): {
		dek: Uint8Array;
		wrappedDeks: Record<string, string>;
	} {
		const dek = generateDEK();
		const wrappedDeks = this.wrapDekForAllDevices(dek);
		this.sessionDeks.set(sessionId, dek);
		this.wrappedDeksCache.set(sessionId, wrappedDeks);
		return { dek, wrappedDeks };
	}

	/**
	 * Set an existing DEK for a session (e.g., loaded from WAL).
	 * Re-wraps for all known devices.
	 */
	setSessionDek(sessionId: string, dek: Uint8Array): void {
		this.sessionDeks.set(sessionId, dek);
		this.wrappedDeksCache.set(sessionId, this.wrapDekForAllDevices(dek));
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
	 * Get the per-device wrapped DEKs for a session, or null if not initialized.
	 */
	getWrappedDeks(sessionId: string): Record<string, string> | null {
		return this.wrappedDeksCache.get(sessionId) ?? null;
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

	/**
	 * Get the base64-encoded content public key (Curve25519).
	 */
	getContentPublicKeyBase64(): string {
		const sodium = getSodium();
		return sodium.to_base64(
			this.contentKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		);
	}

	/**
	 * Re-wrap all cached session DEKs for the current set of device content keys.
	 * Call after deviceContentKeys are updated to ensure all sessions are
	 * wrapped for newly registered devices.
	 */
	rewrapAllSessions(): void {
		for (const [sessionId, dek] of this.sessionDeks) {
			this.wrappedDeksCache.set(sessionId, this.wrapDekForAllDevices(dek));
		}
	}

	/**
	 * Wrap a DEK for all known device content keys.
	 * If no device keys are known, wraps only for own content key with a
	 * placeholder device ID "self".
	 */
	private wrapDekForAllDevices(dek: Uint8Array): Record<string, string> {
		const sodium = getSodium();
		const result: Record<string, string> = {};

		if (this.deviceContentKeys.length > 0) {
			for (const device of this.deviceContentKeys) {
				const pubKey = sodium.from_base64(
					device.contentPublicKey,
					sodium.base64_variants.ORIGINAL,
				);
				result[device.deviceId] = wrapDEK(dek, pubKey);
			}
		} else {
			// Fallback: wrap for own content key only
			result.self = wrapDEK(dek, this.contentKeyPair.publicKey);
		}

		return result;
	}
}
