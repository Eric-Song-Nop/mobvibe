import { mkdir, rm } from "node:fs/promises";

const target = process.env.MOBVIBE_BUN_TARGET;
const outfile = process.env.MOBVIBE_BIN_OUTFILE;

if (!target || !outfile) {
	console.error(
		"Missing MOBVIBE_BUN_TARGET or MOBVIBE_BIN_OUTFILE environment variables.",
	);
	process.exit(1);
}

await rm("dist-bin", { recursive: true, force: true });
await mkdir("dist-bin", { recursive: true });

const proc = Bun.spawn(
	[
		"bun",
		"build",
		"./src/index.ts",
		"--compile",
		"--outfile",
		outfile,
		"--target",
		target,
	],
	{ stdio: ["inherit", "inherit", "inherit"] },
);

const exitCode = await proc.exited;
if (exitCode !== 0) {
	process.exit(exitCode);
}

console.log(`Binary build complete: ${outfile}`);
