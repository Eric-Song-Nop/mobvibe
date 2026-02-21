import { createAuthClient } from "better-auth/react";
import { clearAuthToken, getAuthToken, setAuthToken } from "./auth-token";
import { platformFetch } from "./tauri-fetch";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL as string | undefined;

/**
 * Check if running inside Tauri
 */
export const isInTauri = (): boolean => "__TAURI_INTERNALS__" in window;

const inTauri = typeof window !== "undefined" && isInTauri();

// Create auth client with Gateway endpoint
// Note: When Gateway URL is not configured, auth is disabled
const authClient = GATEWAY_URL
	? createAuthClient({
			baseURL: GATEWAY_URL,
			fetchOptions: {
				credentials: inTauri ? "omit" : "include",
				...(inTauri && {
					auth: {
						type: "Bearer" as const,
						token: () => getAuthToken() ?? undefined,
					},
					customFetchImpl: async (
						input: RequestInfo | URL,
						init?: RequestInit,
					) => {
						const res = await platformFetch(input, init);
						const token = res.headers.get("set-auth-token");
						if (token) setAuthToken(token);
						return res;
					},
				}),
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
	const result = await authClient.signOut();
	await clearAuthToken();
	return result;
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
