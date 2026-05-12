import { ThemeProvider } from "@mobvibe/ui/theme-provider";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import App from "@/App";
import "@/i18n";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

hydrateRoot(
	root,
	<StrictMode>
		<ThemeProvider>
			<App />
		</ThemeProvider>
	</StrictMode>,
);
