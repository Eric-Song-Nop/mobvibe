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
		delete process.env.IS_PREVIEW;
		delete process.env.FLY_APP_NAME;
		delete process.env.FLY_ALLOC_ID;
		delete process.env.FLY_REGION;
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

	it("detects preview mode via IS_PREVIEW", async () => {
		process.env.IS_PREVIEW = "true";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.isPreview).toBe(true);
	});

	it("isPreview defaults to false when IS_PREVIEW is not set", async () => {
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.isPreview).toBe(false);
	});

	it("SITE_URL takes priority over FLY_APP_NAME for siteUrl", async () => {
		process.env.SITE_URL = "https://custom.example.com";
		process.env.FLY_APP_NAME = "my-fly-app";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.siteUrl).toBe("https://custom.example.com");
	});

	it("derives siteUrl from FLY_APP_NAME when SITE_URL is not set", async () => {
		process.env.FLY_APP_NAME = "mobvibe-gw-pr-42";
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.siteUrl).toBe("https://mobvibe-gw-pr-42.fly.dev");
	});

	it("siteUrl is undefined when neither SITE_URL nor FLY_APP_NAME is set", async () => {
		const { getGatewayConfig } = await import("../config.js");
		const config = getGatewayConfig();
		expect(config.siteUrl).toBeUndefined();
	});
});
