import { type CodeAccent, getCodeAccentTextClass } from "@/lib/code-highlight";

const languageByExtension: Record<string, string> = {
	".astro": "astro",
	".c": "c",
	".cc": "cpp",
	".cpp": "cpp",
	".css": "css",
	".go": "go",
	".graphql": "graphql",
	".gql": "graphql",
	".h": "c",
	".hpp": "cpp",
	".html": "html",
	".cs": "csharp",
	".java": "java",
	".js": "javascript",
	".json": "json",
	".jsx": "jsx",
	".md": "markdown",
	".mdx": "mdx",
	".mjs": "javascript",
	".mts": "typescript",
	".php": "php",
	".py": "python",
	".rb": "ruby",
	".rs": "rust",
	".scss": "scss",
	".sh": "bash",
	".sql": "sql",
	".bash": "bash",
	".toml": "toml",
	".ts": "typescript",
	".tsx": "tsx",
	".txt": "text",
	".vue": "vue",
	".xml": "xml",
	".yaml": "yaml",
	".yml": "yaml",
};

const normalizeExtension = (input?: string | null) => {
	if (!input) {
		return "";
	}
	const trimmed = input.trim();
	if (!trimmed) {
		return "";
	}
	const extension = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
	return extension.toLowerCase();
};

export const resolveLanguageFromPath = (pathValue: string) => {
	const extension = normalizeExtension(pathValue.split(".").pop());
	return languageByExtension[extension] ?? "text";
};

export const resolveFileNameFromPath = (pathValue?: string) => {
	if (!pathValue) {
		return undefined;
	}
	const segments = pathValue.split(/[/\\]/).filter(Boolean);
	return segments.at(-1) ?? pathValue;
};

// --- File type label utilities ---

const languageShortLabel: Record<string, string> = {
	astro: "AS",
	c: "C",
	cpp: "C++",
	css: "CSS",
	csharp: "C#",
	go: "GO",
	graphql: "GQL",
	html: "HTM",
	java: "JV",
	javascript: "JS",
	json: "{ }",
	jsx: "JSX",
	markdown: "MD",
	mdx: "MDX",
	php: "PHP",
	python: "PY",
	ruby: "RB",
	rust: "RS",
	scss: "SCS",
	bash: "SH",
	sql: "SQL",
	toml: "TML",
	typescript: "TS",
	tsx: "TSX",
	text: "TXT",
	vue: "VUE",
	xml: "XML",
	yaml: "YML",
};

const languageLabelAccent: Partial<Record<string, CodeAccent>> = {
	typescript: "blue",
	tsx: "blue",
	javascript: "yellow",
	jsx: "yellow",
	python: "green",
	rust: "orange",
	go: "aqua",
	java: "red",
	ruby: "red",
	css: "purple",
	scss: "purple",
	html: "orange",
	json: "yellow",
	markdown: "muted",
	bash: "green",
	sql: "blue",
	graphql: "purple",
	vue: "green",
	csharp: "purple",
	cpp: "blue",
	c: "blue",
};

export const resolveFileTypeLabel = (pathValue: string): string => {
	const language = resolveLanguageFromPath(pathValue);
	return languageShortLabel[language] ?? "";
};

export const resolveFileTypeLabelColor = (pathValue: string): string => {
	const language = resolveLanguageFromPath(pathValue);
	return getCodeAccentTextClass(languageLabelAccent[language] ?? "muted");
};
