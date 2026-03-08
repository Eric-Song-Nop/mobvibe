import type { ToastVariant } from "@/components/ui/toast";
import i18n from "@/i18n";
import type { PermissionToolCall } from "@/lib/acp";
import {
	type ErrorDetail,
	fetchNotificationVapidPublicKey,
	registerWebPushSubscription,
	unregisterWebPushSubscription,
} from "@/lib/api";
import { isInTauri } from "@/lib/auth";
import { useNotificationStore } from "@/lib/notification-store";

export type NotificationVariant = ToastVariant;

type SessionSummary = {
	sessionId: string;
	title?: string;
};

type NotificationPayload = {
	title: string;
	description?: string;
	variant?: NotificationVariant;
};

type NotificationContext = {
	sessionId: string;
	sessions?: Record<string, SessionSummary>;
};

const canUseWebNotification = () => {
	if (typeof window === "undefined" || !("Notification" in window)) {
		return false;
	}
	return true;
};

const canUseWebPush = () =>
	typeof window !== "undefined" &&
	"serviceWorker" in navigator &&
	"PushManager" in window;

const base64UrlToUint8Array = (value: string): Uint8Array => {
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = window.atob(normalized);
	const output = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		output[i] = raw.charCodeAt(i);
	}
	return output;
};

const ensureNotificationServiceWorker = async () => {
	if (!canUseWebPush()) {
		return null;
	}
	try {
		return await navigator.serviceWorker.register("/notification-sw.js", {
			scope: "/",
		});
	} catch {
		return null;
	}
};

const syncWebPushSubscription = async () => {
	if (!canUseWebNotification() || !canUseWebPush()) {
		return;
	}
	const registration = await ensureNotificationServiceWorker();
	if (!registration) {
		return;
	}
	const existingSubscription = await registration.pushManager.getSubscription();
	if (Notification.permission !== "granted") {
		if (existingSubscription) {
			await unregisterWebPushSubscription({
				endpoint: existingSubscription.endpoint,
			}).catch(() => undefined);
			await existingSubscription.unsubscribe().catch(() => undefined);
		}
		return;
	}

	const vapid = await fetchNotificationVapidPublicKey().catch(() => null);
	if (!vapid?.enabled || !vapid.publicKey) {
		return;
	}

	const subscription =
		existingSubscription ??
		(await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: base64UrlToUint8Array(
				vapid.publicKey,
			) as BufferSource,
		}));

	await registerWebPushSubscription({
		subscription: subscription.toJSON(),
		userAgent: navigator.userAgent,
		locale: navigator.language,
	}).catch(() => undefined);
};

const resolveSessionTitle = (
	sessions: Record<string, SessionSummary> | undefined,
	sessionId: string,
): string | undefined => {
	const sessionTitle = sessions?.[sessionId]?.title;
	if (sessionTitle) {
		return sessionTitle;
	}
	return i18n.t("session.defaultTitle");
};

const resolveNotificationTitle = (
	payload: NotificationPayload,
	context?: NotificationContext,
) => {
	if (!context) {
		return payload.title;
	}
	const sessionTitle = resolveSessionTitle(context.sessions, context.sessionId);
	if (!sessionTitle) {
		return payload.title;
	}
	return i18n.t("notifications.withSession", {
		title: payload.title,
		sessionTitle,
	});
};

const emitTauriNotification = async (
	title: string,
	body?: string,
): Promise<boolean> => {
	try {
		const { isPermissionGranted, requestPermission, sendNotification } =
			await import("@tauri-apps/plugin-notification");

		let permissionGranted = await isPermissionGranted();
		if (!permissionGranted) {
			const permission = await requestPermission();
			permissionGranted = permission === "granted";
		}

		if (!permissionGranted) {
			return false;
		}

		sendNotification({ title, body });
		return true;
	} catch {
		return false;
	}
};

const emitWebNotification = (
	payload: NotificationPayload,
	context?: NotificationContext,
) => {
	const title = resolveNotificationTitle(payload, context);
	const body = payload.description;

	// Use Tauri notification plugin when running in Tauri
	if (isInTauri()) {
		void emitTauriNotification(title, body);
		return;
	}

	// Fall back to web Notification API
	if (!canUseWebNotification()) {
		return;
	}
	if (Notification.permission === "default") {
		try {
			void Notification.requestPermission();
		} catch {
			return;
		}
		return;
	}
	if (Notification.permission !== "granted") {
		return;
	}

	try {
		new Notification(title, body ? { body } : undefined);
	} catch {
		return;
	}
};

export const pushNotification = (
	payload: NotificationPayload,
	context?: NotificationContext,
) => {
	useNotificationStore.getState().pushNotification({
		title: resolveNotificationTitle(payload, context),
		description: payload.description,
		variant: payload.variant ?? "info",
	});
	emitWebNotification(payload, context);
};

export const ensureNotificationPermission = async (options?: {
	isAuthenticated?: boolean;
}) => {
	if (isInTauri()) {
		if (options?.isAuthenticated !== true) {
			return;
		}
		try {
			const { isPermissionGranted, requestPermission } = await import(
				"@tauri-apps/plugin-notification"
			);
			const permissionGranted = await isPermissionGranted();
			if (!permissionGranted) {
				await requestPermission();
			}
		} catch {
			return;
		}
		return;
	}

	if (!canUseWebNotification()) {
		return;
	}
	if (options?.isAuthenticated !== true) {
		return;
	}
	let permission = Notification.permission;
	if (permission === "default") {
		try {
			permission = await Notification.requestPermission();
		} catch {
			return;
		}
	}
	if (permission === "granted") {
		await syncWebPushSubscription();
	}
};

export const notifyPermissionRequest = (
	payload: {
		sessionId: string;
		requestId: string;
		toolCall?: PermissionToolCall;
	},
	context?: { sessions?: Record<string, SessionSummary> },
) => {
	const toolLabel =
		payload.toolCall?.title ??
		(payload.toolCall?._meta?.name as string | undefined) ??
		i18n.t("toolCall.toolCall");
	pushNotification(
		{
			title: i18n.t("notifications.permissionRequest"),
			description: i18n.t("notifications.permissionRequestDetail", {
				tool: toolLabel,
			}),
			variant: "warning",
		},
		{ sessionId: payload.sessionId, sessions: context?.sessions },
	);
};

export const notifySessionError = (
	payload: {
		sessionId: string;
		error: ErrorDetail;
	},
	context?: { sessions?: Record<string, SessionSummary> },
) => {
	pushNotification(
		{
			title: i18n.t("notifications.sessionError"),
			description: payload.error.message,
			variant: "error",
		},
		{ sessionId: payload.sessionId, sessions: context?.sessions },
	);
};

export const notifyResponseCompleted = (
	payload: { sessionId: string },
	context?: { sessions?: Record<string, SessionSummary> },
) => {
	pushNotification(
		{
			title: i18n.t("notifications.responseCompleted"),
			variant: "success",
		},
		{ sessionId: payload.sessionId, sessions: context?.sessions },
	);
};
