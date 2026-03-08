import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	use: {
		baseURL: "http://127.0.0.1:4173",
		headless: true,
	},
	webServer: [
		{
			command: "node tests/e2e/fake-gateway.mjs",
			port: 3005,
			reuseExistingServer: true,
			cwd: dirname,
		},
		{
			command: "VITE_GATEWAY_URL= pnpm exec vite --host 127.0.0.1 --port 4173",
			port: 4173,
			reuseExistingServer: true,
			cwd: dirname,
		},
	],
});
