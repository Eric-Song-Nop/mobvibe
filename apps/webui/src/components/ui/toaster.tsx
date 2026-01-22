import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@/components/ui/toast";
import { useNotificationStore } from "@/lib/notification-store";

export function Toaster() {
	const notifications = useNotificationStore((state) => state.notifications);
	const dismissNotification = useNotificationStore(
		(state) => state.dismissNotification,
	);

	return (
		<ToastProvider swipeDirection="right" duration={6000}>
			{notifications.map((notification) => (
				<Toast
					key={notification.id}
					variant={notification.variant}
					onOpenChange={(open) => {
						if (!open) {
							dismissNotification(notification.id);
						}
					}}
				>
					<div className="flex flex-col gap-1">
						<ToastTitle>{notification.title}</ToastTitle>
						{notification.description ? (
							<ToastDescription>{notification.description}</ToastDescription>
						) : null}
					</div>
					<ToastClose />
				</Toast>
			))}
			<ToastViewport />
		</ToastProvider>
	);
}
