import fs from "node:fs";
import path from "node:path";

const dest = path.join(process.cwd(), "public");
fs.mkdirSync(dest, { recursive: true });

// Copy brand assets from brand/
const brandDir = path.resolve(process.cwd(), "..", "..", "brand");
const logoSrc = path.join(brandDir, "logo.svg");
if (fs.existsSync(logoSrc)) {
	fs.copyFileSync(logoSrc, path.join(dest, "logo.svg"));
}
