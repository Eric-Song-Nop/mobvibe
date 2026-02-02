import { describe, expect, it } from "vitest";
import {
	passwordResetEmailTemplate,
	verificationEmailTemplate,
} from "../email-templates.js";

describe("email-templates", () => {
	describe("verificationEmailTemplate", () => {
		it("generates email with user name", () => {
			const result = verificationEmailTemplate({
				userName: "John",
				url: "https://example.com/verify?token=abc123",
			});

			expect(result.subject).toBe("Verify your email address - Mobvibe");
			expect(result.text).toContain("Hi John,");
			expect(result.text).toContain("https://example.com/verify?token=abc123");
			expect(result.html).toContain("Hi John,");
			expect(result.html).toContain(
				'href="https://example.com/verify?token=abc123"',
			);
		});

		it("generates email without user name", () => {
			const result = verificationEmailTemplate({
				url: "https://example.com/verify?token=abc123",
			});

			expect(result.text).toContain("Hi,");
			expect(result.html).toContain("Hi,");
		});

		it("includes verification button and fallback link", () => {
			const result = verificationEmailTemplate({
				userName: "Test User",
				url: "https://example.com/verify?token=xyz",
			});

			expect(result.html).toContain('class="button"');
			expect(result.html).toContain("Verify Email Address");
			expect(result.html).toContain("This link will expire in 24 hours");
			expect(result.html).toContain(
				"If the button doesn't work, copy and paste this link",
			);
		});

		it("includes Mobvibe branding", () => {
			const result = verificationEmailTemplate({
				url: "https://example.com/verify",
			});

			expect(result.html).toContain("Mobvibe");
			expect(result.text).toContain("Mobvibe");
		});
	});

	describe("passwordResetEmailTemplate", () => {
		it("generates email with user name", () => {
			const result = passwordResetEmailTemplate({
				userName: "Jane",
				url: "https://example.com/reset?token=def456",
			});

			expect(result.subject).toBe("Reset your password - Mobvibe");
			expect(result.text).toContain("Hi Jane,");
			expect(result.text).toContain("https://example.com/reset?token=def456");
			expect(result.html).toContain("Hi Jane,");
			expect(result.html).toContain(
				'href="https://example.com/reset?token=def456"',
			);
		});

		it("generates email without user name", () => {
			const result = passwordResetEmailTemplate({
				url: "https://example.com/reset?token=def456",
			});

			expect(result.text).toContain("Hi,");
			expect(result.html).toContain("Hi,");
		});

		it("includes reset button and expiry notice", () => {
			const result = passwordResetEmailTemplate({
				userName: "Test User",
				url: "https://example.com/reset?token=xyz",
			});

			expect(result.html).toContain('class="button"');
			expect(result.html).toContain("Reset Password");
			expect(result.html).toContain("This link will expire in 1 hour");
		});

		it("includes security notice about ignoring email", () => {
			const result = passwordResetEmailTemplate({
				url: "https://example.com/reset",
			});

			expect(result.html).toContain(
				"If you didn't request a password reset, you can safely ignore this email",
			);
			expect(result.text).toContain(
				"If you didn't request a password reset, you can safely ignore this email",
			);
		});
	});
});
