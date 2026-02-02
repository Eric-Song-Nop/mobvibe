import { beforeEach, describe, expect, it, vi } from "vitest";

// Create mock functions
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const mockResendSend = vi.fn();

// Mock the config module
vi.mock("../../config.js", () => ({
	getGatewayConfig: () => ({
		resendApiKey: undefined,
		emailFrom: "Test <test@example.com>",
	}),
}));

// Mock the logger module
vi.mock("../logger.js", () => ({
	logger: {
		info: mockLoggerInfo,
		error: mockLoggerError,
	},
}));

// Mock resend
vi.mock("resend", () => ({
	Resend: class MockResend {
		emails = {
			send: mockResendSend,
		};
	},
}));

describe("email", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("sendEmail without RESEND_API_KEY", () => {
		it("logs email to console when no API key is configured", async () => {
			// Import with default mock (no API key)
			const { sendEmail } = await import("../email.js");

			await sendEmail({
				to: "user@example.com",
				subject: "Test Subject",
				text: "Test content",
			});

			expect(mockLoggerInfo).toHaveBeenCalledWith(
				{
					to: "user@example.com",
					subject: "Test Subject",
					text: "Test content",
				},
				"[DEV] Email would be sent (RESEND_API_KEY not configured)",
			);
		});

		it("does not call Resend when no API key is configured", async () => {
			const { sendEmail } = await import("../email.js");

			await sendEmail({
				to: "user@example.com",
				subject: "Test Subject",
				text: "Test content",
			});

			expect(mockResendSend).not.toHaveBeenCalled();
		});
	});
});

describe("email with RESEND_API_KEY", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();

		// Re-mock config with API key
		vi.doMock("../../config.js", () => ({
			getGatewayConfig: () => ({
				resendApiKey: "re_test_key",
				emailFrom: "Mobvibe <noreply@mobvibe.com>",
			}),
		}));

		// Re-mock logger
		vi.doMock("../logger.js", () => ({
			logger: {
				info: mockLoggerInfo,
				error: mockLoggerError,
			},
		}));

		// Re-mock resend
		vi.doMock("resend", () => ({
			Resend: class MockResend {
				emails = {
					send: mockResendSend,
				};
			},
		}));
	});

	it("sends email via Resend when API key is configured", async () => {
		mockResendSend.mockResolvedValue({
			data: { id: "email-123" },
			error: null,
		});

		const { sendEmail } = await import("../email.js");

		await sendEmail({
			to: "user@example.com",
			subject: "Verify your email",
			text: "Click here to verify",
			html: "<p>Click here to verify</p>",
		});

		expect(mockResendSend).toHaveBeenCalledWith({
			from: "Mobvibe <noreply@mobvibe.com>",
			to: "user@example.com",
			subject: "Verify your email",
			text: "Click here to verify",
			html: "<p>Click here to verify</p>",
		});

		expect(mockLoggerInfo).toHaveBeenCalledWith(
			{
				to: "user@example.com",
				subject: "Verify your email",
				id: "email-123",
			},
			"Email sent successfully",
		);
	});

	it("logs error when Resend returns an error", async () => {
		mockResendSend.mockResolvedValue({
			data: null,
			error: { message: "Invalid API key" },
		});

		const { sendEmail } = await import("../email.js");

		await sendEmail({
			to: "user@example.com",
			subject: "Test",
			text: "Test",
		});

		expect(mockLoggerError).toHaveBeenCalledWith(
			{
				error: { message: "Invalid API key" },
				to: "user@example.com",
				subject: "Test",
			},
			"Failed to send email",
		);
	});

	it("logs error when Resend throws an exception", async () => {
		mockResendSend.mockRejectedValue(new Error("Network error"));

		const { sendEmail } = await import("../email.js");

		await sendEmail({
			to: "user@example.com",
			subject: "Test",
			text: "Test",
		});

		expect(mockLoggerError).toHaveBeenCalledWith(
			expect.objectContaining({
				to: "user@example.com",
				subject: "Test",
			}),
			"Failed to send email",
		);
	});
});
