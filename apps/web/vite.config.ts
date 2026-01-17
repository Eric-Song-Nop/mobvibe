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
			react: path.resolve(__dirname, "../../node_modules/react"),
			"react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
			"react-dom/client": path.resolve(
				__dirname,
				"../../node_modules/react-dom/client",
			),
			"react-dom/test-utils": path.resolve(
				__dirname,
				"../../node_modules/react-dom/test-utils",
			),
			"react/jsx-runtime": path.resolve(
				__dirname,
				"../../node_modules/react/jsx-runtime",
			),
			"react/jsx-dev-runtime": path.resolve(
				__dirname,
				"../../node_modules/react/jsx-dev-runtime",
			),
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
