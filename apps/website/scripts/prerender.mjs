import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const distSsrDir = path.resolve(__dirname, "../dist-ssr");

async function prerender() {
	const { render } = await import(path.join(distSsrDir, "entry-server.js"));

	const indexPath = path.join(distDir, "index.html");
	let html = fs.readFileSync(indexPath, "utf-8");

	const appHtml = render();

	// Inject rendered HTML into the root div
	html = html.replace(
		'<div id="root"></div>',
		`<div id="root">${appHtml}</div>`,
	);

	fs.writeFileSync(indexPath, html, "utf-8");

	console.log(`Prerendered ${appHtml.length} chars into dist/index.html`);
}

prerender().catch((err) => {
	console.error("Prerender failed:", err);
	process.exit(1);
});
