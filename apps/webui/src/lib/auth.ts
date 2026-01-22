import { createAuthClient } from "better-auth/react";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL as string | undefined;

// Create auth client with Gateway endpoint
// Note: When Gateway URL is not configured, auth is disabled
const authClient = GATEWAY_URL
	? createAuthClient({
			baseURL: GATEWAY_URL,
			fetchOptions: {
				credentials: "include",
			},
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
	if (!authClient) {
		return { data: null, isPending: false, error: null };
	}
	return authClient.useSession();
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
