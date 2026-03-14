import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const appleDir = path.resolve(process.cwd(), "src-tauri", "gen", "apple");
const projectYmlPath = path.join(appleDir, "project.yml");

if (!fs.existsSync(projectYmlPath)) {
	console.error(
		"Missing src-tauri/gen/apple/project.yml. Run `pnpm ios:init` first.",
	);
	process.exit(1);
}

const replacements = new Map([
	[
		"$(TOOLCHAIN_DIR)/usr/lib/swift/$(PLATFORM_NAME)",
		"$(DEVELOPER_DIR)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/$(PLATFORM_NAME)",
	],
	[
		"$(TOOLCHAIN_DIR)/usr/lib/swift-5.0/$(PLATFORM_NAME)",
		"$(DEVELOPER_DIR)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.0/$(PLATFORM_NAME)",
	],
]);

let projectYml = fs.readFileSync(projectYmlPath, "utf8");
let changed = false;

for (const [from, to] of replacements) {
	if (projectYml.includes(from)) {
		projectYml = projectYml.replaceAll(from, to);
		changed = true;
	}
}

if (changed) {
	fs.writeFileSync(projectYmlPath, projectYml);
}

execFileSync("xcodegen", ["generate"], {
	cwd: appleDir,
	stdio: "inherit",
});
