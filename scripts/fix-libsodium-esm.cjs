/**
 * libsodium-wrappers ESM entry imports "./libsodium.mjs" relatively,
 * but libsodium is a separate npm package. This script copies the real
 * libsodium ESM file into the expected location.
 *
 * Tries multiple resolution strategies so it works regardless of the
 * package manager's node_modules layout (pnpm strict, npm flat, etc.).
 */
const fs = require("fs");
const path = require("path");

// Directories to try resolving libsodium-wrappers from.
// In pnpm strict mode, it's only resolvable from packages that depend on it.
const searchPaths = [
	path.join(__dirname, "..", "packages", "shared"),
	path.join(__dirname, "..", "packages", "core"),
	path.join(__dirname, ".."),
	__dirname,
];

try {
	// Find libsodium-wrappers package directory
	let wrappersEntry = null;
	for (const searchPath of searchPaths) {
		try {
			wrappersEntry = require.resolve("libsodium-wrappers", {
				paths: [searchPath],
			});
			break;
		} catch {}
	}
	if (!wrappersEntry) {
		console.warn("[fix-libsodium-esm] could not resolve libsodium-wrappers");
		return;
	}

	const wrappersPkg = path.dirname(
		findUp("package.json", path.dirname(wrappersEntry)),
	);
	const esmDir = path.join(wrappersPkg, "dist", "modules-esm");
	const target = path.join(esmDir, "libsodium.mjs");

	if (fs.existsSync(target)) {
		const stat = fs.lstatSync(target);
		if (stat.isFile() && stat.size > 0) {
			console.log("[fix-libsodium-esm] already exists:", target);
			return;
		}
		// Remove broken symlink or empty file
		fs.unlinkSync(target);
	}
	if (!fs.existsSync(esmDir)) {
		console.warn("[fix-libsodium-esm] ESM dir not found:", esmDir);
		return;
	}

	// Strategy 1: libsodium is a sibling in pnpm's virtual store
	// e.g. .pnpm/libsodium-wrappers@0.7.16/node_modules/libsodium/
	const siblingSource = path.join(
		path.dirname(wrappersPkg),
		"libsodium",
		"dist",
		"modules-esm",
		"libsodium.mjs",
	);

	// Strategy 2: resolve libsodium from within libsodium-wrappers context
	let resolvedSource = null;
	try {
		const sodiumEntry = require.resolve("libsodium", {
			paths: [wrappersPkg],
		});
		const sodiumPkg = path.dirname(
			findUp("package.json", path.dirname(sodiumEntry)),
		);
		resolvedSource = path.join(
			sodiumPkg,
			"dist",
			"modules-esm",
			"libsodium.mjs",
		);
	} catch {}

	// Try each source in order
	const sources = [siblingSource, resolvedSource].filter(Boolean);
	for (const source of sources) {
		if (fs.existsSync(source)) {
			fs.copyFileSync(source, target);
			console.log("[fix-libsodium-esm] copied", source, "→", target);
			return;
		}
	}

	console.warn("[fix-libsodium-esm] no source found, tried:", sources);
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
