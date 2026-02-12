import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getGatewayConfig", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		// Clean relevant env vars
		delete process.env.PORT;
		delete process.env.GATEWAY_PORT;
		delete process.env.GATEWAY_CORS_ORIGINS;
		delete process.env.SITE_URL;
		delete process.env.DATABASE_URL;
		delete process.env.RESEND_API_KEY;
		delete process.env.EMAIL_FROM;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns default port 3005 when no port env is set", async () => {
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.port).toBe(3005);
	});

	it("parses PORT env variable", async () => {
		process.env.PORT = "4000";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.port).toBe(4000);
	});

	it("parses GATEWAY_PORT env variable", async () => {
		process.env.GATEWAY_PORT = "4001";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.port).toBe(4001);
	});

	it("prefers PORT over GATEWAY_PORT", async () => {
		process.env.PORT = "5000";
		process.env.GATEWAY_PORT = "5001";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.port).toBe(5000);
	});

	it("throws on invalid port", async () => {
		process.env.PORT = "not-a-number";
		const { getGatewayConfig } = await import("../config.js");
		expect(() => getGatewayConfig()).toThrow("Invalid port");
	});

	it("parses comma-separated CORS origins", async () => {
		process.env.GATEWAY_CORS_ORIGINS =
			"http://localhost:5173,https://app.example.com";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.corsOrigins).toEqual([
			"http://localhost:5173",
			"https://app.example.com",
		]);
	});

	it("trims whitespace in CORS origins", async () => {
		process.env.GATEWAY_CORS_ORIGINS =
			" http://a.com , http://b.com , http://c.com ";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.corsOrigins).toEqual([
			"http://a.com",
			"http://b.com",
			"http://c.com",
		]);
	});

	it("returns empty array when CORS origins is empty string", async () => {
		process.env.GATEWAY_CORS_ORIGINS = "";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.corsOrigins).toEqual([]);
	});

	it("returns empty array when CORS origins is not set", async () => {
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.corsOrigins).toEqual([]);
	});

	it("does not include a webUrl property", async () => {
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config).not.toHaveProperty("webUrl");
	});

	it("uses default emailFrom when not set", async () => {
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.emailFrom).toBe("Mobvibe <noreply@example.com>");
	});

	it("uses custom EMAIL_FROM when set", async () => {
		process.env.EMAIL_FROM = "Custom <custom@example.com>";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.emailFrom).toBe("Custom <custom@example.com>");
	});
});
