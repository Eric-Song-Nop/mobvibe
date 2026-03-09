import fs from "node:fs";
import path from "node:path";

const dest = path.join(process.cwd(), "public");
fs.mkdirSync(dest, { recursive: true });

// Copy brand assets from brand/
const brandDir = path.resolve(process.cwd(), "..", "..", "brand");
for (const asset of ["logo.svg", "logo-light.svg", "logo-dark.svg"]) {
	const assetSrc = path.join(brandDir, asset);
	if (fs.existsSync(assetSrc)) {
		fs.copyFileSync(assetSrc, path.join(dest, asset));
	}
}
