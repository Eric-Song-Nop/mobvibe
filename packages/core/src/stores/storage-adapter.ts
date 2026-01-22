import type { StateStorage } from "zustand/middleware";

// Synchronous storage interface
export type SyncStateStorage = {
	getItem: (name: string) => string | null;
	setItem: (name: string, value: string) => void;
	removeItem: (name: string) => void;
};

// Default in-memory storage for environments without localStorage
const inMemoryStorage = new Map<string, string>();

const createInMemoryStorage = (): SyncStateStorage => ({
	getItem: (name: string) => inMemoryStorage.get(name) ?? null,
	setItem: (name: string, value: string) => {
		inMemoryStorage.set(name, value);
	},
	removeItem: (name: string) => {
		inMemoryStorage.delete(name);
	},
});

// Default localStorage storage for web
const createLocalStorage = (): SyncStateStorage => ({
	getItem: (name: string) => {
		try {
			if (typeof globalThis.localStorage !== "undefined") {
				return globalThis.localStorage.getItem(name);
			}
			return null;
		} catch {
			return null;
		}
	},
	setItem: (name: string, value: string) => {
		try {
			if (typeof globalThis.localStorage !== "undefined") {
				globalThis.localStorage.setItem(name, value);
			}
		} catch {
			// Ignore storage errors (e.g., quota exceeded)
		}
	},
	removeItem: (name: string) => {
		try {
			if (typeof globalThis.localStorage !== "undefined") {
				globalThis.localStorage.removeItem(name);
			}
		} catch {
			// Ignore storage errors
		}
	},
});

// Configurable storage adapter
let storageAdapter: SyncStateStorage | null = null;

export const setStorageAdapter = (adapter: SyncStateStorage) => {
	storageAdapter = adapter;
};

export const getStorageAdapter = (): SyncStateStorage => {
	if (storageAdapter) {
		return storageAdapter;
	}

	// Default to localStorage in browser, in-memory otherwise
	if (typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined") {
		return createLocalStorage();
	}

	return createInMemoryStorage();
};

// Helper to create StateStorage from SyncStateStorage
export const createZustandStorage = (storage: SyncStateStorage): StateStorage => ({
	getItem: (name) => storage.getItem(name),
	setItem: (name, value) => storage.setItem(name, value),
	removeItem: (name) => storage.removeItem(name),
});
