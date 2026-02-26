import { mkdir, rm } from "node:fs/promises";

const TARGETS = [
	{ platform: "linux-x64", bunTarget: "bun-linux-x64", bin: "mobvibe" },
	{ platform: "linux-arm64", bunTarget: "bun-linux-arm64", bin: "mobvibe" },
	{ platform: "darwin-x64", bunTarget: "bun-darwin-x64", bin: "mobvibe" },
	{
		platform: "darwin-arm64",
		bunTarget: "bun-darwin-arm64",
		bin: "mobvibe",
	},
	{
		platform: "win32-x64",
		bunTarget: "bun-windows-x64",
		bin: "mobvibe.exe",
	},
];

// Support filtering to a single target (backward compat + CI parallel optimization)
const filterPlatform = process.env.MOBVIBE_BUN_TARGET;

for (const target of TARGETS) {
	if (filterPlatform && !target.bunTarget.includes(filterPlatform)) continue;

	const outDir = `npm/${target.platform}/bin`;
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const outfile = `${outDir}/${target.bin}`;
	console.log(`Building ${target.bunTarget} → ${outfile}`);

	const proc = Bun.spawn(
		[
			"bun",
			"build",
			"./src/index.ts",
			"--compile",
			"--minify",
			"--outfile",
			outfile,
			"--target",
			target.bunTarget,
		],
		{ stdio: ["inherit", "inherit", "inherit"] },
	);

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		console.error(`Build failed for ${target.platform}`);
		process.exit(exitCode);
	}
}

console.log("All binary builds complete!");
