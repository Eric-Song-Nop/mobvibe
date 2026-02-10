/**
 * libsodium-wrappers ESM entry imports "./libsodium.mjs" relatively,
 * but libsodium is a separate npm package. This script creates a symlink
 * from the expected path to the actual libsodium ESM file.
 *
 * Uses require.resolve to find actual paths, so it works regardless of
 * the package manager's node_modules layout (pnpm, npm, yarn).
 */
const fs = require("fs");
const path = require("path");

try {
	const wrappersEntry = require.resolve("libsodium-wrappers");
	const wrappersPkg = path.dirname(
		findUp("package.json", path.dirname(wrappersEntry)),
	);
	const esmDir = path.join(wrappersPkg, "dist", "modules-esm");
	const link = path.join(esmDir, "libsodium.mjs");

	if (fs.existsSync(link)) return;
	if (!fs.existsSync(esmDir)) return;

	const sodiumEntry = require.resolve("libsodium");
	const sodiumPkg = path.dirname(
		findUp("package.json", path.dirname(sodiumEntry)),
	);
	const source = path.join(sodiumPkg, "dist", "modules-esm", "libsodium.mjs");

	if (!fs.existsSync(source)) {
		console.warn("[fix-libsodium-esm] source not found:", source);
		return;
	}

	fs.symlinkSync(source, link);
} catch (e) {
	console.warn("[fix-libsodium-esm]", e.message);
}

function findUp(name, dir) {
	const file = path.join(dir, name);
	if (fs.existsSync(file)) return file;
	const parent = path.dirname(dir);
	if (parent === dir) throw new Error(`${name} not found`);
	return findUp(name, parent);
}
