import type { PermissionRequestPayload, SessionEvent } from "@mobvibe/shared";
import webpush from "web-push";
import type { GatewayConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import {
	deleteWebPushSubscription,
	deleteWebPushSubscriptionByEndpoint,
	listWebPushSubscriptionsForUser,
	type UpsertWebPushSubscriptionParams,
	upsertWebPushSubscription,
} from "./db-service.js";

type PresenceResolver = {
	hasUserConnections: (userId: string) => boolean;
	hasSessionSubscribers: (sessionId: string, userId?: string) => boolean;
};

type NotificationServiceOptions = {
	config: GatewayConfig;
	presence: PresenceResolver;
	resolveSessionTitle: (
		userId: string,
		sessionId: string,
	) => string | undefined;
};

type BrowserPushPayload = {
	title: string;
	body?: string;
	tag?: string;
	url: string;
	sessionId?: string;
};

const isGoneSubscriptionError = (
	error: unknown,
): error is { statusCode: number } =>
	typeof error === "object" &&
	error !== null &&
	"statusCode" in error &&
	typeof (error as { statusCode?: unknown }).statusCode === "number";

export class NotificationService {
	private readonly webPushEnabled: boolean;

	constructor(private readonly options: NotificationServiceOptions) {
		const { webPushPublicKey, webPushPrivateKey, webPushSubject } =
			options.config;
		this.webPushEnabled = Boolean(
			webPushPublicKey && webPushPrivateKey && webPushSubject,
		);

		if (webPushPublicKey && webPushPrivateKey && webPushSubject) {
			webpush.setVapidDetails(
				webPushSubject,
				webPushPublicKey,
				webPushPrivateKey,
			);
		}
	}

	isWebPushEnabled(): boolean {
		return this.webPushEnabled;
	}

	getWebPushPublicKey(): string | undefined {
		return this.options.config.webPushPublicKey;
	}

	async registerBrowserSubscription(
		params: UpsertWebPushSubscriptionParams,
	): Promise<void> {
		await upsertWebPushSubscription(params);
	}

	async unregisterBrowserSubscription(
		userId: string,
		endpoint: string,
	): Promise<void> {
		await deleteWebPushSubscription(userId, endpoint);
	}

	async notifyPermissionRequest(
		userId: string,
		payload: PermissionRequestPayload,
	): Promise<void> {
		const sessionTitle = this.resolveSessionTitle(userId, payload.sessionId);
		const toolLabel =
			payload.toolCall?.title ??
			(payload.toolCall?._meta?.name as string | undefined) ??
			"Action required";
		await this.sendBrowserPush(
			userId,
			{
				title: sessionTitle
					? `${sessionTitle}: Permission required`
					: "Permission required",
				body: toolLabel,
				tag: `permission:${payload.requestId}`,
				url: this.buildSessionUrl(payload.sessionId),
				sessionId: payload.sessionId,
			},
			payload.sessionId,
		);
	}

	async notifySessionEvent(userId: string, event: SessionEvent): Promise<void> {
		switch (event.kind) {
			case "turn_end":
				await this.sendBrowserPush(
					userId,
					{
						title: this.withSessionTitle(
							userId,
							event.sessionId,
							"Response completed",
						),
						tag: `turn-end:${event.sessionId}:${event.revision}:${event.seq}`,
						url: this.buildSessionUrl(event.sessionId),
						sessionId: event.sessionId,
					},
					event.sessionId,
				);
				return;
			case "session_error": {
				const payload =
					event.payload &&
					typeof event.payload === "object" &&
					"error" in event.payload
						? (event.payload as {
								error?: { message?: string };
							})
						: undefined;
				await this.sendBrowserPush(
					userId,
					{
						title: this.withSessionTitle(
							userId,
							event.sessionId,
							"Session error",
						),
						body: payload?.error?.message,
						tag: `session-error:${event.sessionId}`,
						url: this.buildSessionUrl(event.sessionId),
						sessionId: event.sessionId,
					},
					event.sessionId,
				);
				return;
			}
			default:
				return;
		}
	}

	private resolveSessionTitle(
		userId: string,
		sessionId: string,
	): string | undefined {
		return this.options.resolveSessionTitle(userId, sessionId);
	}

	private withSessionTitle(
		userId: string,
		sessionId: string,
		title: string,
	): string {
		const sessionTitle = this.resolveSessionTitle(userId, sessionId);
		return sessionTitle ? `${sessionTitle}: ${title}` : title;
	}

	private buildSessionUrl(sessionId: string): string {
		return `/?sessionId=${encodeURIComponent(sessionId)}`;
	}

	private async sendBrowserPush(
		userId: string,
		payload: BrowserPushPayload,
		sessionId?: string,
	): Promise<void> {
		if (!this.webPushEnabled) {
			return;
		}
		if (
			sessionId
				? this.options.presence.hasSessionSubscribers(sessionId, userId)
				: this.options.presence.hasUserConnections(userId)
		) {
			return;
		}

		const subscriptions = await listWebPushSubscriptionsForUser(userId);
		if (subscriptions.length === 0) {
			return;
		}

		const message = JSON.stringify(payload);
		const deliveries = await Promise.allSettled(
			subscriptions.map(async (subscription) => {
				try {
					await webpush.sendNotification(
						{
							endpoint: subscription.endpoint,
							keys: {
								p256dh: subscription.p256dh,
								auth: subscription.auth,
							},
						},
						message,
						{ TTL: 60 },
					);
				} catch (error) {
					if (
						isGoneSubscriptionError(error) &&
						(error.statusCode === 404 || error.statusCode === 410)
					) {
						await deleteWebPushSubscriptionByEndpoint(subscription.endpoint);
						return;
					}
					throw error;
				}
			}),
		);

		for (const result of deliveries) {
			if (result.status === "rejected") {
				logger.warn(
					{ err: result.reason, userId, sessionId },
					"browser_push_delivery_failed",
				);
			}
		}
	}
}
