import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webuiDir = path.resolve(scriptDir, "..");
const buildTaskPath = path.resolve(
	webuiDir,
	"src-tauri",
	"gen",
	"android",
	"buildSrc",
	"src",
	"main",
	"java",
	"com",
	"ericoolen",
	"mobvibe",
	"kotlin",
	"BuildTask.kt",
);
const allowMissing = process.argv.includes("--if-present");

if (!fs.existsSync(buildTaskPath)) {
	if (allowMissing) {
		process.exit(0);
	}

	console.error(
		"Missing src-tauri/gen/android/buildSrc/.../BuildTask.kt. Run `pnpm android:init` first.",
	);
	process.exit(1);
}

const originalArgs =
	'        val args = listOf("tauri", "android", "android-studio-script");';
const patchedArgs =
	'        val args = listOf("--dir", "..", "exec", "tauri", "android", "android-studio-script");';
const buildTask = fs.readFileSync(buildTaskPath, "utf8");

if (!buildTask.includes("workingDir(File(project.projectDir, rootDirRel))")) {
	console.error(
		`Unexpected BuildTask.kt template at ${buildTaskPath}. Expected workingDir to remain rooted at src-tauri.`,
	);
	process.exit(1);
}

if (buildTask.includes(patchedArgs)) {
	process.exit(0);
}

if (!buildTask.includes(originalArgs)) {
	console.error(
		`Unexpected BuildTask.kt template at ${buildTaskPath}. Expected to find the unpatched Tauri CLI args list.`,
	);
	process.exit(1);
}

fs.writeFileSync(buildTaskPath, buildTask.replace(originalArgs, patchedArgs));
