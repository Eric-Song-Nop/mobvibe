import {
	type CryptoKeyPair,
	decryptPayload,
	deriveAuthKeyPair,
	deriveContentKeyPair,
	encryptPayload,
	getSodium,
	initCrypto,
	isEncryptedPayload,
	unwrapDEK,
} from "@mobvibe/core";
import type { SessionEvent } from "@/lib/acp";
import { isInTauri } from "@/lib/auth";

const STORAGE_KEY = "mobvibe_e2ee_secrets";
const LEGACY_STORAGE_KEY = "mobvibe_e2ee_master_secret";

interface StoredSecret {
	secret: string;
	fingerprint: string;
	addedAt: number;
}

class E2EEManager {
	private contentKeyPairs: Map<string, CryptoKeyPair> = new Map();
	private sessionToSecret: Map<string, string> = new Map();
	private sessionDeks: Map<string, Uint8Array> = new Map();

	isEnabled(): boolean {
		return this.contentKeyPairs.size > 0;
	}

	getPairedSecrets(): StoredSecret[] {
		const secrets: StoredSecret[] = [];
		for (const secret of this.contentKeyPairs.keys()) {
			secrets.push({
				secret,
				fingerprint: this.computeFingerprint(secret),
				addedAt: Date.now(),
			});
		}
		return secrets;
	}

	async addPairedSecret(base64Secret: string): Promise<void> {
		if (this.contentKeyPairs.has(base64Secret)) {
			return;
		}
		await initCrypto();
		const sodium = getSodium();
		const masterSecret = sodium.from_base64(
			base64Secret,
			sodium.base64_variants.ORIGINAL,
		);
		const contentKeyPair = deriveContentKeyPair(masterSecret);
		this.contentKeyPairs.set(base64Secret, contentKeyPair);
		await this.persistSecrets();
	}

	async removePairedSecret(base64Secret: string): Promise<void> {
		this.contentKeyPairs.delete(base64Secret);
		for (const [sessionId, secret] of this.sessionToSecret) {
			if (secret === base64Secret) {
				this.sessionToSecret.delete(sessionId);
				this.sessionDeks.delete(sessionId);
			}
		}
		await this.persistSecrets();
	}

	async loadFromStorage(): Promise<boolean> {
		const stored = await this.getStoredSecrets();
		if (!stored || stored.length === 0) {
			const legacy = await this.getLegacyStoredSecret();
			if (legacy) {
				await this.addPairedSecret(legacy);
				await this.removeLegacyStoredSecret();
				return true;
			}
			return false;
		}

		try {
			await initCrypto();
			for (const item of stored) {
				await this.addPairedSecret(item.secret);
			}
			return true;
		} catch {
			return false;
		}
	}

	async setPairedSecret(base64Secret: string): Promise<void> {
		await this.addPairedSecret(base64Secret);
	}

	async clearSecret(): Promise<void> {
		this.contentKeyPairs.clear();
		this.sessionToSecret.clear();
		this.sessionDeks.clear();
		await this.removeStoredSecrets();
	}

	unwrapSessionDek(sessionId: string, wrappedDek: string): boolean {
		const cachedSecret = this.sessionToSecret.get(sessionId);
		if (cachedSecret) {
			const keypair = this.contentKeyPairs.get(cachedSecret);
			if (keypair && this.tryUnwrap(sessionId, wrappedDek, keypair)) {
				return true;
			}
		}

		for (const [secret, keypair] of this.contentKeyPairs) {
			if (this.tryUnwrap(sessionId, wrappedDek, keypair)) {
				this.sessionToSecret.set(sessionId, secret);
				return true;
			}
		}
		return false;
	}

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

	encryptPayloadForSession(sessionId: string, payload: unknown): unknown {
		const dek = this.sessionDeks.get(sessionId);
		if (!dek) return payload;
		return encryptPayload(payload, dek);
	}

	private tryUnwrap(
		sessionId: string,
		wrappedDek: string,
		keypair: CryptoKeyPair,
	): boolean {
		try {
			const dek = unwrapDEK(wrappedDek, keypair.publicKey, keypair.secretKey);
			this.sessionDeks.set(sessionId, dek);
			return true;
		} catch {
			return false;
		}
	}

	private computeFingerprint(base64Secret: string): string {
		const sodium = getSodium();
		const masterSecret = sodium.from_base64(
			base64Secret,
			sodium.base64_variants.ORIGINAL,
		);
		const authKp = deriveAuthKeyPair(masterSecret);
		const authPub = sodium.to_base64(
			authKp.publicKey,
			sodium.base64_variants.ORIGINAL,
		);
		return authPub.slice(0, 8);
	}

	private async persistSecrets(): Promise<void> {
		const secrets: StoredSecret[] = [];
		for (const secret of this.contentKeyPairs.keys()) {
			secrets.push({
				secret,
				fingerprint: this.computeFingerprint(secret),
				addedAt: Date.now(),
			});
		}
		await this.storeSecrets(secrets);
	}

	private async getStoredSecrets(): Promise<StoredSecret[] | null> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				const value = await store.get<StoredSecret[]>(STORAGE_KEY);
				return value ?? null;
			} catch {
				return null;
			}
		}
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as StoredSecret[];
		} catch {
			return null;
		}
	}

	private async getLegacyStoredSecret(): Promise<string | null> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				const value = await store.get<string>(LEGACY_STORAGE_KEY);
				return value ?? null;
			} catch {
				return null;
			}
		}
		return localStorage.getItem(LEGACY_STORAGE_KEY);
	}

	private async storeSecrets(secrets: StoredSecret[]): Promise<void> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				await store.set(STORAGE_KEY, secrets);
				await store.save();
				return;
			} catch {
				// Fall through to localStorage
			}
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(secrets));
	}

	private async removeStoredSecrets(): Promise<void> {
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

	private async removeLegacyStoredSecret(): Promise<void> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				await store.delete(LEGACY_STORAGE_KEY);
				await store.save();
			} catch {
				// Ignore
			}
		}
		localStorage.removeItem(LEGACY_STORAGE_KEY);
	}
}

export const e2ee = new E2EEManager();
