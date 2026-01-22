import type { ToastVariant } from "@/components/ui/toast";
import i18n from "@/i18n";
import type { PermissionToolCall } from "@/lib/acp";
import type { ErrorDetail } from "@/lib/api";
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
	if (typeof window === "undefined" || !("Notification" in window)) {
		return;
	}
	if (Notification.permission === "default") {
		void Notification.requestPermission();
		return;
	}
	if (Notification.permission !== "granted") {
		return;
	}

	new Notification(title, body ? { body } : undefined);
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

export const ensureNotificationPermission = () => {
	// For Tauri, permissions are requested when sending notifications
	if (isInTauri()) {
		return;
	}

	if (typeof window === "undefined" || !("Notification" in window)) {
		return;
	}
	if (Notification.permission === "default") {
		void Notification.requestPermission();
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
		payload.toolCall?.name ??
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
