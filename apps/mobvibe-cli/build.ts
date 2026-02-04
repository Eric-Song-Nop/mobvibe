import { $ } from "bun";

// Clean dist directory
await $`rm -rf dist`;

// Build with Bun bundler
// Bundle local code + @mobvibe/shared, keep node_modules external
const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	sourcemap: "external",
	packages: "external",
});

if (!result.success) {
	console.error("Build failed:");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

// Generate TypeScript declarations
await $`bunx tsc --emitDeclarationOnly --declaration --outDir dist`;

console.log("Build complete!");
