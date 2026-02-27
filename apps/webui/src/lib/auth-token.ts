import { isInTauri } from "./auth";
import { tauriStoreDelete, tauriStoreGet, tauriStoreSet } from "./tauri-store";

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
		const token = await tauriStoreGet<string>("auth.json", "bearerToken");
		if (token) {
			tokenCache = token;
		}
	} catch {
		// Store not available
	}
};

const persistToken = async (token: string): Promise<void> => {
	try {
		await tauriStoreSet("auth.json", "bearerToken", token);
	} catch {
		// Store not available
	}
};

const clearPersistedToken = async (): Promise<void> => {
	try {
		await tauriStoreDelete("auth.json", "bearerToken");
	} catch {
		// Store not available
	}
};
