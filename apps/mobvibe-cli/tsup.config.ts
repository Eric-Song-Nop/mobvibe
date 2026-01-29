import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node22",
	outDir: "dist",
	clean: true,
	sourcemap: true,
	dts: true,
	// Bundle @mobvibe/shared, keep other deps external
	noExternal: ["@mobvibe/shared"],
});
