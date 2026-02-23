import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dest = path.join(process.cwd(), "public");
fs.mkdirSync(dest, { recursive: true });

// 1) Copy tree-sitter wasm files
const modules = [
	"web-tree-sitter/web-tree-sitter.wasm",
	"tree-sitter-javascript/tree-sitter-javascript.wasm",
	"tree-sitter-typescript/tree-sitter-typescript.wasm",
	"tree-sitter-typescript/tree-sitter-tsx.wasm",
	"tree-sitter-bash/tree-sitter-bash.wasm",
	"tree-sitter-c/tree-sitter-c.wasm",
	"tree-sitter-cpp/tree-sitter-cpp.wasm",
	"tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
	"tree-sitter-go/tree-sitter-go.wasm",
	"tree-sitter-java/tree-sitter-java.wasm",
	"tree-sitter-php/tree-sitter-php.wasm",
	"tree-sitter-php/tree-sitter-php_only.wasm",
	"tree-sitter-python/tree-sitter-python.wasm",
	"tree-sitter-ruby/tree-sitter-ruby.wasm",
	"tree-sitter-rust/tree-sitter-rust.wasm",
];

for (const mod of modules) {
	const src = require.resolve(mod);
	fs.copyFileSync(src, path.join(dest, path.basename(mod)));
}

// 2) Copy brand assets from brand/
const brandDir = path.resolve(process.cwd(), "..", "..", "brand");
const logoSrc = path.join(brandDir, "logo.svg");
if (fs.existsSync(logoSrc)) {
	fs.copyFileSync(logoSrc, path.join(dest, "logo.svg"));
}
