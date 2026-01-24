import { createAuthClient } from "better-auth/react";
import { apiKeyClient } from "better-auth/client/plugins";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL as string | undefined;

/**
 * Check if running inside Tauri
 */
export const isInTauri = (): boolean => "__TAURI_INTERNALS__" in window;

/**
 * Dynamic fetch implementation that uses Tauri HTTP plugin on macOS
 * to properly handle cookies (standard fetch doesn't work with cookies in Tauri on macOS)
 */
const createFetchImpl = async () => {
	if (!isInTauri()) {
		return fetch;
	}

	try {
		const [{ fetch: tauriFetch }, { platform }] = await Promise.all([
			import("@tauri-apps/plugin-http"),
			import("@tauri-apps/plugin-os"),
		]);
		const currentPlatform = platform();

		// Use Tauri fetch on macOS when running in Tauri protocol
		if (currentPlatform === "macos" && window.location.protocol === "tauri:") {
			return tauriFetch as typeof fetch;
		}
	} catch {
		// Fall back to standard fetch if plugins not available
	}

	return fetch;
};

// Cached fetch implementation
let cachedFetchImpl: typeof fetch | null = null;

const getFetchImpl = async (): Promise<typeof fetch> => {
	if (!cachedFetchImpl) {
		cachedFetchImpl = await createFetchImpl();
	}
	return cachedFetchImpl;
};

// Create auth client with Gateway endpoint
// Note: When Gateway URL is not configured, auth is disabled
const authClient = GATEWAY_URL
	? createAuthClient({
			baseURL: GATEWAY_URL,
			fetchOptions: {
				credentials: "include",
				customFetchImpl: async (...params: Parameters<typeof fetch>) => {
					const fetchImpl = await getFetchImpl();
					return fetchImpl(...params);
				},
			},
			plugins: [apiKeyClient()],
		})
	: null;

export function isAuthEnabled(): boolean {
	return authClient !== null;
}

export function getAuthClient() {
	return authClient;
}

// Re-export hooks from better-auth/react
export const useSession = () => {
	const session = authClient?.useSession();
	if (!session) {
		return { data: null, isPending: false, error: null };
	}
	return session;
};

// Auth actions
export const signIn = {
	email: async (credentials: { email: string; password: string }) => {
		if (!authClient) {
			throw new Error("Auth not configured");
		}
		return authClient.signIn.email(credentials);
	},
	social: async (provider: "github" | "google") => {
		if (!authClient) {
			throw new Error("Auth not configured");
		}
		return authClient.signIn.social({ provider });
	},
};

export const signUp = {
	email: async (data: { email: string; password: string; name: string }) => {
		if (!authClient) {
			throw new Error("Auth not configured");
		}
		return authClient.signUp.email(data);
	},
};

export const signOut = async () => {
	if (!authClient) {
		throw new Error("Auth not configured");
	}
	return authClient.signOut();
};

// Get session token for API calls
export const getSessionToken = async (): Promise<string | null> => {
	if (!authClient) {
		return null;
	}
	const session = await authClient.getSession();
	return session?.data?.session?.token ?? null;
};

// Store for reactive session token access
let cachedToken: string | null = null;

export const getCachedToken = (): string | null => cachedToken;

export const updateCachedToken = (token: string | null): void => {
	cachedToken = token;
};

// API Key methods
export type ApiKeyData = {
	id: string;
	name: string | null;
	start: string | null;
	createdAt: Date;
	expiresAt: Date | null;
};

export const apiKey = {
	create: async (data: { name?: string; expiresIn?: number }) => {
		if (!authClient) {
			throw new Error("Auth not configured");
		}
		return authClient.apiKey.create(data);
	},
	list: async () => {
		if (!authClient) {
			throw new Error("Auth not configured");
		}
		return authClient.apiKey.list();
	},
	delete: async (data: { keyId: string }) => {
		if (!authClient) {
			throw new Error("Auth not configured");
		}
		return authClient.apiKey.delete(data);
	},
};
