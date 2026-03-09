import { getLegalDocumentByPath, legalDocuments } from "@/lib/legal-data";

const siteUrl = "https://mobvibe.net";

export type WebsitePageMeta = {
	title: string;
	description: string;
	canonicalUrl: string;
	ogTitle: string;
	ogDescription: string;
	ogUrl: string;
};

export type WebsitePage =
	| {
			kind: "home";
			pathname: "/";
			meta: WebsitePageMeta;
	  }
	| {
			kind: "legal";
			pathname: `/${string}`;
			documentId: (typeof legalDocuments)[number]["id"];
			meta: WebsitePageMeta;
	  };

const homeMeta: WebsitePageMeta = {
	title: "Mobvibe - AI Agent Management",
	description:
		"Manage AI coding agents across multiple machines with real-time streaming, end-to-end encryption, and cross-platform support.",
	canonicalUrl: `${siteUrl}/`,
	ogTitle: "Mobvibe - AI Agent Management",
	ogDescription:
		"Manage AI coding agents across multiple machines with real-time streaming, end-to-end encryption, and cross-platform support.",
	ogUrl: `${siteUrl}/`,
};

const normalizePath = (pathname?: string) => {
	if (!pathname || pathname === "/") {
		return "/";
	}

	return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
};

export const resolveWebsitePage = (pathname?: string): WebsitePage => {
	const normalizedPath = normalizePath(pathname);
	const legalDocument = getLegalDocumentByPath(normalizedPath);

	if (!legalDocument) {
		return {
			kind: "home",
			pathname: "/",
			meta: homeMeta,
		};
	}

	return {
		kind: "legal",
		pathname: legalDocument.slug,
		documentId: legalDocument.id,
		meta: {
			title: `${legalDocument.locales.en.title} | Mobvibe`,
			description: legalDocument.locales.en.summary,
			canonicalUrl: `${siteUrl}${legalDocument.slug}`,
			ogTitle: `${legalDocument.locales.en.title} | Mobvibe`,
			ogDescription: legalDocument.locales.en.summary,
			ogUrl: `${siteUrl}${legalDocument.slug}`,
		},
	};
};

export const websitePrerenderPaths = [
	"/",
	...legalDocuments.map((document) => document.slug),
];
