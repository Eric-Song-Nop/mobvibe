import type { Router } from "express";
import { logger } from "../lib/logger.js";
import {
	type AuthenticatedRequest,
	getUserId,
	requireAuth,
} from "../middleware/auth.js";
import type { NotificationService } from "../services/notification-service.js";

const isPushSubscriptionBody = (
	value: unknown,
): value is {
	subscription: {
		endpoint: string;
		keys?: {
			p256dh?: string;
			auth?: string;
		};
	};
	userAgent?: string;
	locale?: string;
} =>
	typeof value === "object" &&
	value !== null &&
	"subscription" in value &&
	typeof (value as { subscription?: { endpoint?: unknown } }).subscription
		?.endpoint === "string";

export function setupNotificationRoutes(
	router: Router,
	notificationService: NotificationService,
) {
	router.use(requireAuth);

	router.get("/vapid-public-key", (request: AuthenticatedRequest, response) => {
		const userId = getUserId(request);
		if (!userId) {
			response.status(401).json({ error: "AUTH_REQUIRED" });
			return;
		}

		response.json({
			enabled: notificationService.isWebPushEnabled(),
			publicKey: notificationService.getWebPushPublicKey() ?? null,
		});
	});

	router.put(
		"/web-subscription",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}
			if (!isPushSubscriptionBody(request.body)) {
				response.status(400).json({ error: "Invalid push subscription body" });
				return;
			}

			const endpoint = request.body.subscription.endpoint;
			const p256dh = request.body.subscription.keys?.p256dh;
			const auth = request.body.subscription.keys?.auth;
			if (!endpoint || !p256dh || !auth) {
				response
					.status(400)
					.json({ error: "Push subscription keys are required" });
				return;
			}

			try {
				await notificationService.registerBrowserSubscription({
					userId,
					endpoint,
					p256dh,
					auth,
					userAgent:
						typeof request.body.userAgent === "string"
							? request.body.userAgent
							: request.get("user-agent"),
					locale:
						typeof request.body.locale === "string"
							? request.body.locale
							: undefined,
				});
				response.status(204).send();
			} catch (error) {
				logger.error(
					{ err: error, userId },
					"web_push_subscription_upsert_error",
				);
				response
					.status(500)
					.json({ error: "Failed to save push subscription" });
			}
		},
	);

	router.delete(
		"/web-subscription",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				response.status(401).json({ error: "AUTH_REQUIRED" });
				return;
			}

			const endpoint =
				typeof request.body?.endpoint === "string"
					? request.body.endpoint
					: null;
			if (!endpoint) {
				response.status(400).json({ error: "endpoint is required" });
				return;
			}

			try {
				await notificationService.unregisterBrowserSubscription(
					userId,
					endpoint,
				);
				response.status(204).send();
			} catch (error) {
				logger.error(
					{ err: error, userId },
					"web_push_subscription_delete_error",
				);
				response
					.status(500)
					.json({ error: "Failed to delete push subscription" });
			}
		},
	);
}
