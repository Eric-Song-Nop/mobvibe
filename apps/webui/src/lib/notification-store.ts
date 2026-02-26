import { create } from "zustand";
import { createLocalId } from "@/lib/id-utils";
import type { NotificationVariant } from "@/lib/notifications";

export type ToastNotification = {
	id: string;
	title: string;
	description?: string;
	variant: NotificationVariant;
	createdAt: string;
};

type NotificationState = {
	notifications: ToastNotification[];
	pushNotification: (
		payload: Omit<ToastNotification, "id" | "createdAt">,
	) => void;
	dismissNotification: (id: string) => void;
};

export const useNotificationStore = create<NotificationState>((set) => ({
	notifications: [],
	pushNotification: (payload) =>
		set((state) => ({
			notifications: [
				...state.notifications,
				{
					id: createLocalId(),
					createdAt: new Date().toISOString(),
					...payload,
				},
			],
		})),
	dismissNotification: (id) =>
		set((state) => ({
			notifications: state.notifications.filter(
				(notification) => notification.id !== id,
			),
		})),
}));
