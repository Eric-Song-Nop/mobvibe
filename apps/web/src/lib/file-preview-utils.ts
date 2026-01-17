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
	".java": "java",
	".js": "javascript",
	".json": "json",
	".jsx": "jsx",
	".kt": "kotlin",
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
	".swift": "swift",
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
