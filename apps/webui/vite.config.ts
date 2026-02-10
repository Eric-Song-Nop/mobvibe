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
	optimizeDeps: {
		include: ["libsodium-wrappers"],
	},
	build: {
		rollupOptions: {
			plugins: [
				{
					name: "resolve-libsodium",
					resolveId(source, importer) {
						// libsodium-wrappers ESM imports "./libsodium.mjs" expecting it relative,
						// but libsodium is a separate npm package
						if (
							source === "./libsodium.mjs" &&
							importer?.includes("libsodium-wrappers")
						) {
							return {
								id: path.resolve(
									__dirname,
									"../../node_modules/libsodium/dist/modules-esm/libsodium.mjs",
								),
								external: false,
							};
						}
						return null;
					},
				},
			],
		},
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
