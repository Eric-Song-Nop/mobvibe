#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const PLATFORMS = {
	"linux-x64": "@mobvibe/cli-linux-x64",
	"linux-arm64": "@mobvibe/cli-linux-arm64",
	"darwin-x64": "@mobvibe/cli-darwin-x64",
	"darwin-arm64": "@mobvibe/cli-darwin-arm64",
	"win32-x64": "@mobvibe/cli-win32-x64",
};

const platformKey = `${process.platform}-${process.arch}`;
const pkgName = PLATFORMS[platformKey];

if (!pkgName) {
	console.error(`Unsupported platform: ${platformKey}`);
	console.error(`Supported: ${Object.keys(PLATFORMS).join(", ")}`);
	process.exit(1);
}

const binName = process.platform === "win32" ? "mobvibe.exe" : "mobvibe";

let binaryPath;
try {
	const require = createRequire(import.meta.url);
	binaryPath = require.resolve(`${pkgName}/bin/${binName}`);
} catch {
	console.error(
		`Could not find binary for ${platformKey}. ` +
			`Expected package: ${pkgName}\n` +
			`Try reinstalling: npm install @mobvibe/cli`,
	);
	process.exit(1);
}

try {
	execFileSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
} catch (error) {
	// execFileSync throws on non-zero exit code; forward the exit code
	process.exit(error.status ?? 1);
}
