import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_GATEWAY_URL", "https://gateway.example");

const mockSendVerificationEmail = vi.fn();
const mockSignInEmail = vi.fn();
const mockSignInSocial = vi.fn();
const mockSignInOAuth2 = vi.fn();
const mockSignUpEmail = vi.fn();
const mockSignOut = vi.fn();
const mockClearAuthToken = vi.fn();
const mockOpenUrl = vi.fn();

vi.mock("better-auth/client/plugins", () => ({
	genericOAuthClient: vi.fn(() => ({
		id: "generic-oauth-client",
	})),
}));

vi.mock("better-auth/react", () => ({
	createAuthClient: vi.fn(() => ({
		sendVerificationEmail: mockSendVerificationEmail,
		signIn: {
			email: mockSignInEmail,
			social: mockSignInSocial,
			oauth2: mockSignInOAuth2,
		},
		signUp: {
			email: mockSignUpEmail,
		},
		signOut: mockSignOut,
		useSession: vi.fn(() => ({ data: null, isPending: false, error: null })),
	})),
}));

vi.mock("../auth-token", () => ({
	getAuthToken: vi.fn(() => null),
	setAuthToken: vi.fn(),
	clearAuthToken: mockClearAuthToken.mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

const setTauriWindow = (enabled: boolean) => {
	if (enabled) {
		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			value: {},
			configurable: true,
		});
		return;
	}

	delete (window as Window & { __TAURI_INTERNALS__?: unknown })
		.__TAURI_INTERNALS__;
};

const loadAuthModule = async () => import("../auth");

describe("auth", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		setTauriWindow(false);
	});

	describe("sendVerificationEmail", () => {
		it("calls authClient.sendVerificationEmail with email", async () => {
			mockSendVerificationEmail.mockResolvedValue({ data: {}, error: null });

			const { sendVerificationEmail } = await loadAuthModule();

			await sendVerificationEmail({ email: "user@example.com" });

			expect(mockSendVerificationEmail).toHaveBeenCalledWith({
				email: "user@example.com",
				callbackURL: "http://localhost:3000/login?verified=1",
			});
		});

		it("returns the result from authClient", async () => {
			const expectedResult = { data: { success: true }, error: null };
			mockSendVerificationEmail.mockResolvedValue(expectedResult);

			const { sendVerificationEmail } = await loadAuthModule();

			const result = await sendVerificationEmail({ email: "user@example.com" });

			expect(result).toEqual(expectedResult);
		});
	});

	describe("signIn.email", () => {
		it("calls authClient.signIn.email with credentials", async () => {
			mockSignInEmail.mockResolvedValue({ data: {}, error: null });

			const { signIn } = await loadAuthModule();

			await signIn.email({
				email: "user@example.com",
				password: "password123",
			});

			expect(mockSignInEmail).toHaveBeenCalledWith({
				email: "user@example.com",
				password: "password123",
				callbackURL: "http://localhost:3000/login?verified=1",
			});
		});
	});

	describe("signIn.social", () => {
		it("uses Better Auth social sign-in directly in the browser", async () => {
			mockSignInSocial.mockResolvedValue({ data: {}, error: null });

			const { signIn } = await loadAuthModule();

			await signIn.social({
				provider: "github",
				returnPath: "/settings",
			});

			expect(mockSignInSocial).toHaveBeenCalledWith({
				provider: "github",
				callbackURL: "http://localhost:3000/settings",
			});
			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("rewrites the social redirect URI for Tauri deep-link handling", async () => {
			setTauriWindow(true);
			mockSignInSocial.mockResolvedValue({
				data: {
					redirect: false,
					url: "https://github.com/login/oauth/authorize?redirect_uri=https%3A%2F%2Fgateway.example%2Fapi%2Fauth%2Fcallback%2Fgithub",
				},
				error: null,
			});

			const { signIn } = await loadAuthModule();

			await signIn.social({
				provider: "github",
				returnPath: "/settings",
			});

			expect(mockSignInSocial).toHaveBeenCalledWith({
				provider: "github",
				disableRedirect: true,
			});
			expect(mockOpenUrl).toHaveBeenCalledTimes(1);

			const openedUrl = new URL(mockOpenUrl.mock.calls[0][0] as string);
			const redirectUri = new URL(openedUrl.searchParams.get("redirect_uri")!);

			expect(`${redirectUri.origin}${redirectUri.pathname}`).toBe(
				"https://gateway.example/api/auth/callback/github",
			);
			expect(redirectUri.searchParams.get("callbackURL")).toBe(
				"mobvibe://api/auth/callback/github?callbackURL=mobvibe%3A%2F%2Fsettings",
			);
		});
	});

	describe("signIn.oauth2", () => {
		it("uses Better Auth oauth2 sign-in directly in the browser", async () => {
			mockSignInOAuth2.mockResolvedValue({ data: {}, error: null });

			const { signIn } = await loadAuthModule();

			await signIn.oauth2({
				providerId: "linux-do",
				returnPath: "/",
			});

			expect(mockSignInOAuth2).toHaveBeenCalledWith({
				providerId: "linux-do",
				callbackURL: "http://localhost:3000/",
			});
			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("rewrites the oauth2 redirect URI for Tauri deep-link handling", async () => {
			setTauriWindow(true);
			mockSignInOAuth2.mockResolvedValue({
				data: {
					redirect: false,
					url: "https://connect.linux.do/oauth2/authorize?redirect_uri=https%3A%2F%2Fgateway.example%2Fapi%2Fauth%2Foauth2%2Fcallback%2Flinux-do",
				},
				error: null,
			});

			const { signIn } = await loadAuthModule();

			await signIn.oauth2({
				providerId: "linux-do",
				returnPath: "/settings",
			});

			expect(mockSignInOAuth2).toHaveBeenCalledWith({
				providerId: "linux-do",
				disableRedirect: true,
			});
			expect(mockOpenUrl).toHaveBeenCalledTimes(1);

			const openedUrl = new URL(mockOpenUrl.mock.calls[0][0] as string);
			const redirectUri = new URL(openedUrl.searchParams.get("redirect_uri")!);

			expect(`${redirectUri.origin}${redirectUri.pathname}`).toBe(
				"https://gateway.example/api/auth/oauth2/callback/linux-do",
			);
			expect(redirectUri.searchParams.get("callbackURL")).toBe(
				"mobvibe://api/auth/oauth2/callback/linux-do?callbackURL=mobvibe%3A%2F%2Fsettings",
			);
		});
	});

	describe("signUp.email", () => {
		it("calls authClient.signUp.email with user data", async () => {
			mockSignUpEmail.mockResolvedValue({ data: {}, error: null });

			const { signUp } = await loadAuthModule();

			await signUp.email({
				email: "newuser@example.com",
				password: "password123",
				name: "New User",
			});

			expect(mockSignUpEmail).toHaveBeenCalledWith({
				email: "newuser@example.com",
				password: "password123",
				name: "New User",
				callbackURL: "http://localhost:3000/login?verified=1",
			});
		});
	});

	describe("signOut", () => {
		it("calls authClient.signOut", async () => {
			mockSignOut.mockResolvedValue({ data: {}, error: null });

			const { signOut } = await loadAuthModule();

			await signOut();

			expect(mockSignOut).toHaveBeenCalled();
		});

		it("clears the stored auth token after sign-out", async () => {
			mockSignOut.mockResolvedValue({ data: {}, error: null });

			const { signOut } = await loadAuthModule();

			await signOut();

			expect(mockClearAuthToken).toHaveBeenCalled();
		});
	});

	describe("isAuthEnabled", () => {
		it("returns true when GATEWAY_URL is configured", async () => {
			const { isAuthEnabled } = await loadAuthModule();

			expect(isAuthEnabled()).toBe(true);
		});
	});
});

describe("auth without GATEWAY_URL", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		setTauriWindow(false);
		vi.stubEnv("VITE_GATEWAY_URL", "");
	});

	it("keeps the auth-disabled path available for future regression coverage", () => {
		expect(true).toBe(true);
	});
});
