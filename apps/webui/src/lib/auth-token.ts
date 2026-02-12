import { isInTauri } from "./auth";

let tokenCache: string | null = null;

export const getAuthToken = (): string | null => tokenCache;

export const setAuthToken = (token: string): void => {
	tokenCache = token;
	if (isInTauri()) {
		void persistToken(token);
	}
};

export const clearAuthToken = async (): Promise<void> => {
	tokenCache = null;
	if (isInTauri()) {
		await clearPersistedToken();
	}
};

export const loadAuthToken = async (): Promise<void> => {
	if (!isInTauri()) return;
	try {
		const { load } = await import("@tauri-apps/plugin-store");
		const store = await load("auth.json");
		const token = await store.get<string>("bearerToken");
		if (token) {
			tokenCache = token;
		}
	} catch {
		// Store not available
	}
};

const persistToken = async (token: string): Promise<void> => {
	try {
		const { load } = await import("@tauri-apps/plugin-store");
		const store = await load("auth.json");
		await store.set("bearerToken", token);
		await store.save();
	} catch {
		// Store not available
	}
};

const clearPersistedToken = async (): Promise<void> => {
	try {
		const { load } = await import("@tauri-apps/plugin-store");
		const store = await load("auth.json");
		await store.delete("bearerToken");
		await store.save();
	} catch {
		// Store not available
	}
};
