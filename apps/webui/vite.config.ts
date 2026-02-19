// @ts-nocheck - Disable type checking due to vite version mismatch between @tailwindcss/vite and main vite
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
		dedupe: ["react", "react-dom"],
	},
	server: {
		host: "0.0.0.0",
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: "./src/setup-tests.ts",
		server: {
			deps: {
				inline: ["react", "react-dom"],
			},
		},
	},
});
