import fs from "node:fs";
import path from "node:path";

const buildDir = path.resolve(process.cwd(), "src-tauri", "gen", "apple", "build");

if (fs.existsSync(buildDir)) {
	fs.rmSync(buildDir, { recursive: true, force: true });
}
