import { create } from "zustand";
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

const createLocalId = () => {
	const cryptoRef = globalThis.crypto;
	if (cryptoRef?.randomUUID) {
		return cryptoRef.randomUUID();
	}
	if (cryptoRef?.getRandomValues) {
		const bytes = new Uint8Array(16);
		cryptoRef.getRandomValues(bytes);
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const toHex = (value: number) => value.toString(16).padStart(2, "0");
		const hex = Array.from(bytes, toHex);
		return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
	}
	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
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
