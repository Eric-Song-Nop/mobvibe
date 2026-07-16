import { ThemeProvider } from "@mobvibe/ui/theme-provider";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "@/App";
import "@/i18n";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const app = (
	<StrictMode>
		<ThemeProvider>
			<App />
		</ThemeProvider>
	</StrictMode>
);

if (root.hasChildNodes()) {
	hydrateRoot(root, app);
} else {
	createRoot(root).render(app);
}
