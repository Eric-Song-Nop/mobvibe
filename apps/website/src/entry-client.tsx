import { ThemeProvider } from "@mobvibe/ui/theme-provider";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "@/App";
import "@/i18n";
import "@/index.css";
import { mountClientRoot } from "@/lib/mount-client-root";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const app = (
	<StrictMode>
		<ThemeProvider>
			<App />
		</ThemeProvider>
	</StrictMode>
);

mountClientRoot(root, {
	render: () => createRoot(root).render(app),
	hydrate: () => hydrateRoot(root, app),
});
