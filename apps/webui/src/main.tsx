import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "@/components/auth/AuthProvider";
import "./i18n";
import "./index.css";
import App from "./App.tsx";

const queryClient = new QueryClient();

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

// Initialize Tauri storage adapter if running in Tauri
if ("__TAURI_INTERNALS__" in window) {
	import("./lib/tauri-storage-adapter")
		.then(({ initTauriStorage }) => initTauriStorage())
		.then(renderApp)
		.catch((error) => {
			console.warn("Failed to initialize Tauri storage, using default:", error);
			renderApp();
		});
} else {
	renderApp();
}
