import {
	type CryptoKeyPair,
	decryptPayload,
	deriveAuthKeyPair,
	deriveContentKeyPair,
	generateMasterSecret,
	getSodium,
	initCrypto,
	isEncryptedPayload,
	unwrapDEK,
} from "@mobvibe/core";
import type { SessionEvent } from "@/lib/acp";
import { isInTauri } from "@/lib/auth";

const STORAGE_KEY = "mobvibe_e2ee_master_secret";
const DEVICE_ID_KEY = "mobvibe_e2ee_device_id";

class E2EEManager {
	private contentKeyPair: CryptoKeyPair | null = null;
	private sessionDeks: Map<string, Uint8Array> = new Map();
	private deviceId: string | null = null;
	private registering = false;

	isEnabled(): boolean {
		return this.contentKeyPair !== null;
	}

	getDeviceId(): string | null {
		return this.deviceId;
	}

	/**
	 * Load persisted master secret and device ID from storage.
	 * Should be called during app initialization.
	 */
	async loadFromStorage(): Promise<boolean> {
		const stored = await this.getStoredSecret();
		if (!stored) return false;

		try {
			await this.applySecret(stored);
			this.deviceId = await this.getStoredDeviceId();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Auto-initialize E2EE for this device.
	 * Generates a new master secret, derives keys, and registers with the gateway.
	 * Only call this when the user is authenticated and E2EE is not yet enabled.
	 */
	async autoInitialize(gatewayUrl: string): Promise<boolean> {
		if (this.isEnabled() || this.registering) return false;
		this.registering = true;

		try {
			await initCrypto();
			const sodium = getSodium();
			const masterSecret = generateMasterSecret();
			const base64Secret = sodium.to_base64(
				masterSecret,
				sodium.base64_variants.ORIGINAL,
			);

			await this.applySecret(base64Secret);

			// Register device with gateway
			const registered = await this.registerDevice(gatewayUrl, masterSecret);
			if (!registered) {
				// Rollback
				this.contentKeyPair = null;
				this.sessionDeks.clear();
				return false;
			}

			await this.storeSecret(base64Secret);
			return true;
		} catch {
			this.contentKeyPair = null;
			this.sessionDeks.clear();
			return false;
		} finally {
			this.registering = false;
		}
	}

	/**
	 * Register this device's keys with the gateway.
	 * Uses the auth key pair for device identity and content key pair for DEK wrapping.
	 */
	private async registerDevice(
		gatewayUrl: string,
		masterSecret: Uint8Array,
	): Promise<boolean> {
		const sodium = getSodium();
		const authKeyPair = deriveAuthKeyPair(masterSecret);
		const contentKeyPair = deriveContentKeyPair(masterSecret);

		const publicKeyBase64 = sodium.to_base64(
			authKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		);
		const contentPublicKeyBase64 = sodium.to_base64(
			contentKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		);

		try {
			const response = await fetch(`${gatewayUrl}/auth/device/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					publicKey: publicKeyBase64,
					contentPublicKey: contentPublicKeyBase64,
					deviceName: this.getDeviceName(),
				}),
			});

			if (!response.ok) return false;

			const data = (await response.json()) as {
				success: boolean;
				deviceId: string;
			};
			if (data.success && data.deviceId) {
				this.deviceId = data.deviceId;
				await this.storeDeviceId(data.deviceId);
				return true;
			}
			return false;
		} catch {
			return false;
		}
	}

	/**
	 * Clear the master secret and all derived state.
	 */
	async clearSecret(): Promise<void> {
		this.contentKeyPair = null;
		this.sessionDeks.clear();
		this.deviceId = null;
		await this.removeStoredSecret();
		await this.removeStoredDeviceId();
	}

	/**
	 * Unwrap a session DEK from the per-device wrappedDeks map.
	 * Tries own device ID first, then "self" key, then all entries as last resort.
	 * Returns true if successful.
	 */
	unwrapSessionDeks(
		sessionId: string,
		wrappedDeks: Record<string, string>,
	): boolean {
		if (!this.contentKeyPair) return false;

		// Try own device ID first
		if (this.deviceId && wrappedDeks[this.deviceId]) {
			if (this.tryUnwrap(sessionId, wrappedDeks[this.deviceId])) {
				return true;
			}
		}

		// Try "self" fallback key (from CLIs without device content keys)
		if (wrappedDeks.self) {
			if (this.tryUnwrap(sessionId, wrappedDeks.self)) {
				return true;
			}
		}

		// Try all entries as a last resort
		for (const wrapped of Object.values(wrappedDeks)) {
			if (this.tryUnwrap(sessionId, wrapped)) {
				return true;
			}
		}

		return false;
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

	private tryUnwrap(sessionId: string, wrappedDek: string): boolean {
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

	private getDeviceName(): string {
		if (typeof navigator !== "undefined") {
			return `WebUI (${navigator.userAgent.split(" ").pop() ?? "Browser"})`;
		}
		return "WebUI";
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

	private async getStoredDeviceId(): Promise<string | null> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				const value = await store.get<string>(DEVICE_ID_KEY);
				return value ?? null;
			} catch {
				return null;
			}
		}
		return localStorage.getItem(DEVICE_ID_KEY);
	}

	private async storeDeviceId(deviceId: string): Promise<void> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				await store.set(DEVICE_ID_KEY, deviceId);
				await store.save();
			} catch {
				localStorage.setItem(DEVICE_ID_KEY, deviceId);
			}
			return;
		}
		localStorage.setItem(DEVICE_ID_KEY, deviceId);
	}

	private async removeStoredDeviceId(): Promise<void> {
		if (isInTauri()) {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const store = await load("app-state.json");
				await store.delete(DEVICE_ID_KEY);
				await store.save();
			} catch {
				// Ignore
			}
		}
		localStorage.removeItem(DEVICE_ID_KEY);
	}
}

export const e2ee = new E2EEManager();
