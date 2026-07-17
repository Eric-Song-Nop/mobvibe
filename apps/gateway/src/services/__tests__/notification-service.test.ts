import type { PermissionRequestPayload } from "@mobvibe/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { NotificationService } from "../notification-service.js";

const mocks = vi.hoisted(() => ({
	sendNotification: vi.fn().mockResolvedValue(undefined),
	setVapidDetails: vi.fn(),
	listWebPushSubscriptionsForUser: vi.fn(),
}));

vi.mock("web-push", () => ({
	default: {
		sendNotification: mocks.sendNotification,
		setVapidDetails: mocks.setVapidDetails,
	},
}));

vi.mock("../db-service.js", () => ({
	deleteWebPushSubscription: vi.fn(),
	deleteWebPushSubscriptionByEndpoint: vi.fn(),
	listWebPushSubscriptionsForUser: mocks.listWebPushSubscriptionsForUser,
	upsertWebPushSubscription: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
	logger: {
		warn: vi.fn(),
	},
}));

const config: GatewayConfig = {
	port: 3005,
	corsOrigins: [],
	siteUrl: undefined,
	databaseUrl: undefined,
	resendApiKey: undefined,
	emailFrom: "Mobvibe <noreply@example.com>",
	skipEmailVerification: false,
	isPreview: false,
	instanceId: "gateway-test",
	flyRegion: undefined,
	redisUrl: undefined,
	webPushPublicKey: "public-key",
	webPushPrivateKey: "private-key",
	webPushSubject: "mailto:test@example.com",
};

describe("NotificationService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listWebPushSubscriptionsForUser.mockResolvedValue([
			{
				id: "subscription-1",
				endpoint: "https://push.example/subscription-1",
				p256dh: "p256dh",
				auth: "auth",
				locale: null,
			},
		]);
	});

	it("ignores a malformed opaque tool name when building permission pushes", async () => {
		const service = new NotificationService({
			config,
			resolveSessionTitle: () => undefined,
		});
		const opaque = "must-not-leak";
		const payload = {
			sessionId: "session-1",
			requestId: "request-1",
			options: [],
			toolCall: {
				_meta: { name: { opaque } },
			},
		} as unknown as PermissionRequestPayload;

		await service.notifyPermissionRequest("user-1", payload);

		expect(mocks.sendNotification).toHaveBeenCalledOnce();
		const message = mocks.sendNotification.mock.calls[0]?.[1];
		expect(typeof message).toBe("string");
		expect(JSON.parse(message as string)).toEqual(
			expect.objectContaining({ body: "Action required" }),
		);
		expect(JSON.stringify(mocks.sendNotification.mock.calls)).not.toContain(
			opaque,
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});
});
