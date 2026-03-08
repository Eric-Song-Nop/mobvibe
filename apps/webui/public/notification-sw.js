self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = {};
	}

	const title =
		typeof payload.title === "string" && payload.title.length > 0
			? payload.title
			: "Mobvibe";
	const options = {
		body: typeof payload.body === "string" ? payload.body : undefined,
		tag: typeof payload.tag === "string" ? payload.tag : undefined,
		data: {
			url: typeof payload.url === "string" ? payload.url : "/",
			sessionId:
				typeof payload.sessionId === "string" ? payload.sessionId : undefined,
		},
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url =
		typeof event.notification.data?.url === "string"
			? event.notification.data.url
			: "/";

	event.waitUntil(
		(async () => {
			const clients = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});

			for (const client of clients) {
				if ("focus" in client) {
					await client.focus();
				}
				if ("navigate" in client) {
					await client.navigate(url);
				}
				return;
			}

			if (self.clients.openWindow) {
				await self.clients.openWindow(url);
			}
		})(),
	);
});
