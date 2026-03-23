import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { clearAuthToken, getAuthToken, setAuthToken } from "./auth-token";
import { platformFetch } from "./tauri-fetch";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL as string | undefined;
const TAURI_AUTH_BASE_PATH = "/api/auth";
const TAURI_SCHEME = "mobvibe";

type SocialAuthProvider = "apple" | "github";
type OAuth2ProviderId = "linux-do";

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
			plugins: [genericOAuthClient()],
		})
	: null;

const ensureLeadingSlash = (path: string) =>
	path.startsWith("/") ? path : `/${path}`;

export const getSafeAuthReturnPath = (
	value: string | null | undefined,
): string => {
	if (!value?.startsWith("/") || value.startsWith("//")) {
		return "/";
	}

	return value;
};

const getPostAuthCallbackURL = (returnPath: string) =>
	new URL(getSafeAuthReturnPath(returnPath), window.location.origin).toString();

const toTauriDeepLink = (path: string) =>
	`${TAURI_SCHEME}:/${ensureLeadingSlash(path)}`;

const rewriteTauriOAuthRedirect = (params: {
	authURL: string;
	callbackPath: string;
	returnPath: string;
}) => {
	const authURL = new URL(params.authURL);
	const redirectURI = authURL.searchParams.get("redirect_uri");
	if (!redirectURI) {
		throw new Error("OAuth redirect URI missing from provider URL");
	}

	const callbackURL = new URL(redirectURI);
	callbackURL.searchParams.set(
		"callbackURL",
		`${toTauriDeepLink(
			`${TAURI_AUTH_BASE_PATH}${ensureLeadingSlash(params.callbackPath)}`,
		)}?${new URLSearchParams({
			callbackURL: toTauriDeepLink(getSafeAuthReturnPath(params.returnPath)),
		}).toString()}`,
	);

	authURL.searchParams.set("redirect_uri", callbackURL.toString());
	return authURL.toString();
};

const openTauriOAuthFlow = async (params: {
	authURL: string;
	callbackPath: string;
	returnPath: string;
}) => {
	const { openUrl } = await import("@tauri-apps/plugin-opener");
	await openUrl(rewriteTauriOAuthRedirect(params));
};

function requireAuthClient() {
	if (!authClient) throw new Error("Auth not configured");
	return authClient;
}

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
		return requireAuthClient().signIn.email({
			...credentials,
			callbackURL: `${window.location.origin}/login?verified=1`,
		});
	},
	social: async (params: {
		provider: SocialAuthProvider;
		returnPath?: string;
	}) => {
		const returnPath = getSafeAuthReturnPath(params.returnPath);
		if (inTauri) {
			const result = await requireAuthClient().signIn.social({
				provider: params.provider,
				disableRedirect: true,
			});
			if (result.data?.url) {
				await openTauriOAuthFlow({
					authURL: result.data.url,
					callbackPath: `/callback/${params.provider}`,
					returnPath,
				});
			}
			return result;
		}

		return requireAuthClient().signIn.social({
			provider: params.provider,
			callbackURL: getPostAuthCallbackURL(returnPath),
		});
	},
	oauth2: async (params: {
		providerId: OAuth2ProviderId;
		returnPath?: string;
	}) => {
		const returnPath = getSafeAuthReturnPath(params.returnPath);
		if (inTauri) {
			const result = await requireAuthClient().signIn.oauth2({
				providerId: params.providerId,
				disableRedirect: true,
			});
			if (result.data?.url) {
				await openTauriOAuthFlow({
					authURL: result.data.url,
					callbackPath: `/oauth2/callback/${params.providerId}`,
					returnPath,
				});
			}
			return result;
		}

		return requireAuthClient().signIn.oauth2({
			providerId: params.providerId,
			callbackURL: getPostAuthCallbackURL(returnPath),
		});
	},
};

export const sendVerificationEmail = async (params: { email: string }) => {
	return requireAuthClient().sendVerificationEmail({
		...params,
		callbackURL: `${window.location.origin}/login?verified=1`,
	});
};

export const signUp = {
	email: async (data: { email: string; password: string; name: string }) => {
		return requireAuthClient().signUp.email({
			...data,
			callbackURL: `${window.location.origin}/login?verified=1`,
		});
	},
};

export const signOut = async () => {
	const result = await requireAuthClient().signOut();
	await clearAuthToken();
	return result;
};

export const changePassword = async (data: {
	currentPassword: string;
	newPassword: string;
}) => {
	return requireAuthClient().changePassword(data);
};
