import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const distSsrDir = path.resolve(__dirname, "../dist-ssr");

async function prerender() {
	const { render, websitePrerenderPaths } = await import(
		path.join(distSsrDir, "entry-server.js")
	);

	const templatePath = path.join(distDir, "index.html");
	const template = fs.readFileSync(templatePath, "utf-8");

	for (const pathname of websitePrerenderPaths) {
		const { html: appHtml, meta } = render(pathname);
		const outputPath =
			pathname === "/"
				? templatePath
				: path.join(distDir, pathname.slice(1), "index.html");

		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(
			outputPath,
			applyMetadata(
				template.replace(
					'<div id="root"></div>',
					`<div id="root">${appHtml}</div>`,
				),
				meta,
			),
			"utf-8",
		);

		console.log(
			`Prerendered ${pathname} -> ${path.relative(distDir, outputPath)}`,
		);
	}
}

function applyMetadata(html, meta) {
	return html
		.replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`)
		.replace(
			/<meta name="description" content=".*?" \/>/,
			`<meta name="description" content="${meta.description}" />`,
		)
		.replace(
			/<link rel="canonical" href=".*?" \/>/,
			`<link rel="canonical" href="${meta.canonicalUrl}" />`,
		)
		.replace(
			/<meta property="og:url" content=".*?" \/>/,
			`<meta property="og:url" content="${meta.ogUrl}" />`,
		)
		.replace(
			/<meta property="og:title" content=".*?" \/>/,
			`<meta property="og:title" content="${meta.ogTitle}" />`,
		)
		.replace(
			/<meta property="og:description" content=".*?" \/>/,
			`<meta property="og:description" content="${meta.ogDescription}" />`,
		)
		.replace(
			/<meta name="twitter:title" content=".*?" \/>/,
			`<meta name="twitter:title" content="${meta.ogTitle}" />`,
		)
		.replace(
			/<meta name="twitter:description" content=".*?" \/>/,
			`<meta name="twitter:description" content="${meta.ogDescription}" />`,
		);
}

prerender().catch((err) => {
	console.error("Prerender failed:", err);
	process.exit(1);
});
