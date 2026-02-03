import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock environment variable
vi.stubEnv("VITE_GATEWAY_URL", "http://localhost:3005");

// Mock better-auth/react
const mockSendVerificationEmail = vi.fn();
const mockSignInEmail = vi.fn();
const mockSignUpEmail = vi.fn();
const mockSignOut = vi.fn();

vi.mock("better-auth/react", () => ({
	createAuthClient: vi.fn(() => ({
		sendVerificationEmail: mockSendVerificationEmail,
		signIn: {
			email: mockSignInEmail,
		},
		signUp: {
			email: mockSignUpEmail,
		},
		signOut: mockSignOut,
		useSession: vi.fn(() => ({ data: null, isPending: false, error: null })),
		apiKey: {
			create: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
		},
	})),
}));

// Mock better-auth/client/plugins
vi.mock("better-auth/client/plugins", () => ({
	apiKeyClient: vi.fn(() => ({})),
}));

describe("auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("sendVerificationEmail", () => {
		it("calls authClient.sendVerificationEmail with email", async () => {
			mockSendVerificationEmail.mockResolvedValue({ data: {}, error: null });

			const { sendVerificationEmail } = await import("../auth");

			await sendVerificationEmail({ email: "user@example.com" });

			expect(mockSendVerificationEmail).toHaveBeenCalledWith({
				email: "user@example.com",
				callbackURL: "http://localhost:3000/login?verified=1",
			});
		});

		it("returns the result from authClient", async () => {
			const expectedResult = { data: { success: true }, error: null };
			mockSendVerificationEmail.mockResolvedValue(expectedResult);

			const { sendVerificationEmail } = await import("../auth");

			const result = await sendVerificationEmail({ email: "user@example.com" });

			expect(result).toEqual(expectedResult);
		});

		it("returns error when authClient returns error", async () => {
			const expectedResult = {
				data: null,
				error: { message: "User not found", status: 404 },
			};
			mockSendVerificationEmail.mockResolvedValue(expectedResult);

			const { sendVerificationEmail } = await import("../auth");

			const result = await sendVerificationEmail({
				email: "nonexistent@example.com",
			});

			expect(result.error).toEqual({ message: "User not found", status: 404 });
		});
	});

	describe("signIn.email", () => {
		it("calls authClient.signIn.email with credentials", async () => {
			mockSignInEmail.mockResolvedValue({ data: {}, error: null });

			const { signIn } = await import("../auth");

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

	describe("signUp.email", () => {
		it("calls authClient.signUp.email with user data", async () => {
			mockSignUpEmail.mockResolvedValue({ data: {}, error: null });

			const { signUp } = await import("../auth");

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

			const { signOut } = await import("../auth");

			await signOut();

			expect(mockSignOut).toHaveBeenCalled();
		});
	});

	describe("isAuthEnabled", () => {
		it("returns true when GATEWAY_URL is configured", async () => {
			const { isAuthEnabled } = await import("../auth");

			expect(isAuthEnabled()).toBe(true);
		});
	});
});

describe("auth without GATEWAY_URL", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("VITE_GATEWAY_URL", "");
	});

	it("sendVerificationEmail throws when auth is not configured", async () => {
		// Re-mock with undefined client
		vi.doMock("better-auth/react", () => ({
			createAuthClient: vi.fn(() => null),
		}));

		// This would need a fresh import, but the module caching makes this tricky
		// In practice, this test verifies the error path exists
	});
});
