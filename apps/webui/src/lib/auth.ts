import { apiKeyClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL as string | undefined;

/**
 * Check if running inside Tauri
 */
export const isInTauri = (): boolean => "__TAURI_INTERNALS__" in window;

/**
 * Check if running in Tauri production mode (not dev server).
 * In dev mode, deep links don't work because the scheme isn't registered.
 * Production uses tauri://localhost origin, dev uses http://localhost:5173
 */
const isInTauriProduction = (): boolean => {
	return isInTauri() && window.location.origin.startsWith("tauri://");
};

/**
 * Get the platform name for Tauri auth flow.
 * This header tells the server to use deep link OAuth.
 */
let cachedPlatform: string | null = null;

const initPlatformDetection = async (): Promise<void> => {
	if (!isInTauri()) return;
	try {
		const { platform } = await import("@tauri-apps/plugin-os");
		cachedPlatform = platform();
	} catch {
		cachedPlatform = "unknown";
	}
};

// Initialize immediately
void initPlatformDetection();

const getTauriPlatform = (): string | null => {
	// Only return platform for production Tauri (where deep links work)
	// In dev mode, return null to skip deep link flow
	if (!isInTauriProduction()) return null;
	// Return cached value or default to "linux" until async detection completes
	return cachedPlatform ?? "linux";
};

/**
 * Dynamic fetch implementation that uses Tauri HTTP plugin
 * to properly handle cookies (standard fetch doesn't work with cookies in Tauri)
 */
const createFetchImpl = async () => {
	if (!isInTauri()) {
		return fetch;
	}

	try {
		const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
		// Use Tauri fetch on all platforms when running inside Tauri
		// This bypasses browser cookie restrictions for cross-origin requests
		return tauriFetch as typeof fetch;
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

// Get platform header for Tauri production (deep link flow)
const platformHeader = getTauriPlatform();

// Create auth client with Gateway endpoint
// Note: When Gateway URL is not configured, auth is disabled
const authClient = GATEWAY_URL
	? createAuthClient({
			baseURL: GATEWAY_URL,
			fetchOptions: {
				credentials: "include",
				// Send platform header for Tauri production to enable deep link OAuth flow
				// In dev mode, platformHeader is null so we use regular web auth
				headers: platformHeader ? { platform: platformHeader } : undefined,
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
		// In Tauri production, use "/" as callbackURL - deep link handler navigates after auth
		// In Tauri dev or web, use full origin URL for regular web auth flow
		const callbackURL = isInTauriProduction()
			? "/"
			: window.location.origin + "/";
		return authClient.signIn.social({
			provider,
			callbackURL,
		});
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
