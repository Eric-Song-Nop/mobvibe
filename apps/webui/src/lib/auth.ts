import { createAuthClient } from "better-auth/react";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL as string | undefined;

/**
 * Check if running inside Tauri
 */
export const isInTauri = (): boolean => "__TAURI_INTERNALS__" in window;

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
			plugins: [],
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
		return authClient.signIn.email({
			...credentials,
			callbackURL: `${window.location.origin}/login?verified=1`,
		});
	},
};

export const sendVerificationEmail = async (params: { email: string }) => {
	if (!authClient) {
		throw new Error("Auth not configured");
	}
	return authClient.sendVerificationEmail({
		...params,
		callbackURL: `${window.location.origin}/login?verified=1`,
	});
};

export const signUp = {
	email: async (data: { email: string; password: string; name: string }) => {
		if (!authClient) {
			throw new Error("Auth not configured");
		}
		return authClient.signUp.email({
			...data,
			callbackURL: `${window.location.origin}/login?verified=1`,
		});
	},
};

export const signOut = async () => {
	if (!authClient) {
		throw new Error("Auth not configured");
	}
	return authClient.signOut();
};

export const changePassword = async (data: {
	currentPassword: string;
	newPassword: string;
}) => {
	if (!authClient) {
		throw new Error("Auth not configured");
	}
	return authClient.changePassword(data);
};
