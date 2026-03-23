import react from "@vitejs/plugin-react";
import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: "./src/setup-tests.ts",
		exclude: [...configDefaults.exclude, "tests/e2e/**"],
		server: {
			deps: {
				inline: ["react", "react-dom"],
			},
		},
	},
});
