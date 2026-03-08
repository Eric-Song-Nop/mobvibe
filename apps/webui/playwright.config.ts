import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const runOffset = process.env.CI ? 0 : process.pid % 1000;
const gatewayPort = Number(
	process.env.PLAYWRIGHT_GATEWAY_PORT ?? String(33005 + runOffset),
);
const webPort = Number(
	process.env.PLAYWRIGHT_WEB_PORT ?? String(34173 + runOffset),
);

process.env.PLAYWRIGHT_GATEWAY_PORT = String(gatewayPort);
process.env.PLAYWRIGHT_WEB_PORT = String(webPort);

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	workers: 1,
	expect: {
		timeout: 10_000,
	},
	use: {
		baseURL: `http://127.0.0.1:${webPort}`,
		headless: true,
	},
	webServer: [
		{
			command: `PLAYWRIGHT_GATEWAY_PORT=${gatewayPort} node tests/e2e/fake-gateway.mjs`,
			port: gatewayPort,
			reuseExistingServer: false,
			cwd: dirname,
		},
		{
			command: `VITE_GATEWAY_URL= VITE_API_GATEWAY_URL=http://127.0.0.1:${gatewayPort} pnpm exec vite --host 127.0.0.1 --port ${webPort}`,
			port: webPort,
			reuseExistingServer: false,
			cwd: dirname,
		},
	],
});
