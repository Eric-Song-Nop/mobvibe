#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to load from dist first, fallback to tsx for development
async function main() {
	try {
		const { run } = await import(join(__dirname, "../dist/index.js"));
		await run();
	} catch (error) {
		// Development mode: use tsx to run TypeScript directly
		const { execSync } = await import("node:child_process");
		const tsxPath = join(__dirname, "../node_modules/.bin/tsx");
		const srcPath = join(__dirname, "../src/index.ts");
		execSync(`"${tsxPath}" "${srcPath}" ${process.argv.slice(2).join(" ")}`, {
			stdio: "inherit",
			cwd: join(__dirname, ".."),
		});
	}
}

main();
