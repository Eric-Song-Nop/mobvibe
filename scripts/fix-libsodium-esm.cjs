/**
 * libsodium-wrappers ESM entry imports "./libsodium.mjs" relatively,
 * but libsodium is a separate npm package. This script copies the real
 * libsodium ESM file into the expected location.
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
	const target = path.join(esmDir, "libsodium.mjs");

	if (fs.existsSync(target)) {
		// Already exists (real file, symlink, or previous copy)
		const stat = fs.lstatSync(target);
		if (stat.isFile() && stat.size > 0) return;
		// Remove broken symlink
		fs.unlinkSync(target);
	}
	if (!fs.existsSync(esmDir)) return;

	// Resolve libsodium from within libsodium-wrappers (it's a direct dep)
	const sodiumEntry = require.resolve("libsodium", { paths: [wrappersPkg] });
	const sodiumPkg = path.dirname(
		findUp("package.json", path.dirname(sodiumEntry)),
	);
	const source = path.join(sodiumPkg, "dist", "modules-esm", "libsodium.mjs");

	if (!fs.existsSync(source)) {
		console.warn("[fix-libsodium-esm] source not found:", source);
		return;
	}

	// Copy instead of symlink — more reliable across pnpm store layouts
	fs.copyFileSync(source, target);
	console.log("[fix-libsodium-esm] copied", source, "→", target);
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
