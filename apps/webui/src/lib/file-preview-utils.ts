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

const languageLabelColor: Record<string, string> = {
	typescript: "text-blue-500",
	tsx: "text-blue-400",
	javascript: "text-yellow-500",
	jsx: "text-yellow-400",
	python: "text-emerald-500",
	rust: "text-orange-500",
	go: "text-cyan-500",
	java: "text-red-400",
	ruby: "text-red-500",
	css: "text-purple-500",
	scss: "text-pink-500",
	html: "text-orange-400",
	json: "text-amber-400",
	markdown: "text-gray-400",
	bash: "text-green-500",
	sql: "text-indigo-400",
	graphql: "text-pink-400",
	vue: "text-emerald-400",
	csharp: "text-violet-500",
	cpp: "text-blue-600",
	c: "text-blue-700",
};

export const resolveFileTypeLabel = (pathValue: string): string => {
	const language = resolveLanguageFromPath(pathValue);
	return languageShortLabel[language] ?? "";
};

export const resolveFileTypeLabelColor = (pathValue: string): string => {
	const language = resolveLanguageFromPath(pathValue);
	return languageLabelColor[language] ?? "text-muted-foreground";
};
