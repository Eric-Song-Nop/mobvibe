import {
	type CryptoKeyPair,
	decryptPayload,
	deriveContentKeyPair,
	getSodium,
	initCrypto,
	isEncryptedPayload,
	unwrapDEK,
} from "@mobvibe/core";
import type { SessionEvent } from "@/lib/acp";
import { isInTauri } from "@/lib/auth";

const STORAGE_KEY = "mobvibe_e2ee_master_secret";

class E2EEManager {
	private contentKeyPair: CryptoKeyPair | null = null;
	private sessionDeks: Map<string, Uint8Array> = new Map();

	isEnabled(): boolean {
		return this.contentKeyPair !== null;
	}

	/**
	 * Load persisted master secret from storage (localStorage or Tauri store).
	 * Should be called during app initialization.
	 */
	async loadFromStorage(): Promise<boolean> {
		const stored = await this.getStoredSecret();
		if (!stored) return false;

		try {
			await this.applySecret(stored);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Set and persist a master secret from user input (pairing flow).
	 */
	async setPairedSecret(base64Secret: string): Promise<void> {
		await this.applySecret(base64Secret);
		await this.storeSecret(base64Secret);
	}

	/**
	 * Clear the master secret and all derived state.
	 */
	async clearSecret(): Promise<void> {
		this.contentKeyPair = null;
		this.sessionDeks.clear();
		await this.removeStoredSecret();
	}

	/**
	 * Unwrap a session DEK from its wrapped (base64) form.
	 * Returns true if successful, false if E2EE is not enabled or unwrapping fails.
	 */
	unwrapSessionDek(sessionId: string, wrappedDek: string): boolean {
		if (!this.contentKeyPair) return false;

		try {
			const dek = unwrapDEK(
				wrappedDek,
				this.contentKeyPair.publicKey,
				this.contentKeyPair.secretKey,
			);
			this.sessionDeks.set(sessionId, dek);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Decrypt an event's payload if it is encrypted.
	 * Returns the event unchanged if payload is not encrypted or E2EE is not enabled.
	 */
	decryptEvent(event: SessionEvent): SessionEvent {
		if (!isEncryptedPayload(event.payload)) return event;

		const dek = this.sessionDeks.get(event.sessionId);
		if (!dek) return event;

		try {
			const decrypted = decryptPayload(event.payload, dek);
			return { ...event, payload: decrypted };
		} catch (error) {
			console.warn("[E2EE] Failed to decrypt event", event.sessionId, error);
			return event;
		}
	}

	private async applySecret(base64Secret: string): Promise<void> {
		await initCrypto();
		const sodium = getSodium();
		const masterSecret = sodium.from_base64(
			base64Secret,
			sodium.base64_variants.ORIGINAL,
		);
		this.contentKeyPair = deriveContentKeyPair(masterSecret);
		this.sessionDeks.clear();
	}

	private async getStoredSecret(): Promise<string | null> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				const value = await store.get<string>(STORAGE_KEY);
				return value ?? null;
			} catch {
				return null;
			}
		}
		return localStorage.getItem(STORAGE_KEY);
	}

	private async storeSecret(base64Secret: string): Promise<void> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				await store.set(STORAGE_KEY, base64Secret);
				await store.save();
			} catch {
				// Fall through to localStorage
				localStorage.setItem(STORAGE_KEY, base64Secret);
			}
			return;
		}
		localStorage.setItem(STORAGE_KEY, base64Secret);
	}

	private async removeStoredSecret(): Promise<void> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				await store.delete(STORAGE_KEY);
				await store.save();
			} catch {
				// Ignore
			}
		}
		localStorage.removeItem(STORAGE_KEY);
	}
}

export const e2ee = new E2EEManager();
