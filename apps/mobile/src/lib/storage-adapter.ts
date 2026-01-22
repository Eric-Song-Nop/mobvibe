import type { SyncStateStorage } from "@remote-claude/core/stores";
import * as SecureStore from "expo-secure-store";

// SecureStore has size limits, so we use a different key prefix
const STORAGE_PREFIX = "mobvibe.store.";

// In-memory storage for large data (chat history)
// This is sync and can be used directly with Zustand's persist
const inMemoryStorage = new Map<string, string>();

export const createInMemoryStorageAdapter = (): SyncStateStorage => ({
	getItem: (name: string): string | null => {
		return inMemoryStorage.get(name) ?? null;
	},
	setItem: (name: string, value: string): void => {
		inMemoryStorage.set(name, value);
	},
	removeItem: (name: string): void => {
		inMemoryStorage.delete(name);
	},
});

// Helper to persist to SecureStore asynchronously (for critical settings)
export const secureStorePersist = {
	getItem: async (name: string): Promise<string | null> => {
		try {
			return await SecureStore.getItemAsync(`${STORAGE_PREFIX}${name}`);
		} catch (error) {
			console.error(`Failed to get item ${name}:`, error);
			return null;
		}
	},
	setItem: async (name: string, value: string): Promise<void> => {
		try {
			await SecureStore.setItemAsync(`${STORAGE_PREFIX}${name}`, value);
		} catch (error) {
			console.error(`Failed to set item ${name}:`, error);
		}
	},
	removeItem: async (name: string): Promise<void> => {
		try {
			await SecureStore.deleteItemAsync(`${STORAGE_PREFIX}${name}`);
		} catch (error) {
			console.error(`Failed to remove item ${name}:`, error);
		}
	},
};
