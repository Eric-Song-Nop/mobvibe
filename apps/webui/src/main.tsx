import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { setApiBaseUrl } from "@/lib/api";
import { isInTauri } from "@/lib/auth";
import { loadAuthToken } from "@/lib/auth-token";
import { e2ee } from "@/lib/e2ee";
import { getGatewayUrl } from "@/lib/gateway-config";
import { gatewaySocket } from "@/lib/socket";
import "./i18n";
import "./index.css";
import App from "./App.tsx";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 60_000,
			refetchOnWindowFocus: false,
		},
	},
});

const renderApp = () => {
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<BrowserRouter>
				<QueryClientProvider client={queryClient}>
					<AuthProvider>
						<App />
					</AuthProvider>
				</QueryClientProvider>
			</BrowserRouter>
		</StrictMode>,
	);
};

const initTauriGateway = async () => {
	try {
		const gatewayUrl = await getGatewayUrl();
		setApiBaseUrl(gatewayUrl);
		gatewaySocket.setGatewayUrl(gatewayUrl);
	} catch (error) {
		console.warn("Failed to load Tauri gateway URL, using default:", error);
	}
};

const initE2EE = async () => {
	try {
		await e2ee.loadFromStorage();
	} catch (error) {
		console.warn("Failed to initialize E2EE:", error);
	}
};

// Initialize Tauri storage adapter if running in Tauri
if (isInTauri()) {
	import("./lib/tauri-storage-adapter")
		.then(({ initTauriStorage }) => initTauriStorage())
		.then(initTauriGateway)
		.then(loadAuthToken)
		.then(initE2EE)
		.then(renderApp)
		.catch((error) => {
			console.warn("Failed to initialize Tauri storage, using default:", error);
			initTauriGateway()
				.then(loadAuthToken)
				.then(initE2EE)
				.finally(renderApp)
				.catch(() => {
					renderApp();
				});
		});
} else {
	initE2EE().then(renderApp);
}
