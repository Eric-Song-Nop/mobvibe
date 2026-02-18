#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "..", "dist", "index.js");

const { run } = await import(distPath);
run().catch((error) => {
	console.error("Error:", error.message);
	process.exit(1);
});
