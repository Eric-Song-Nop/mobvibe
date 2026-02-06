import type { Language } from "prism-react-renderer";
import { Prism, themes } from "prism-react-renderer";
import { useEffect, useState } from "react";

/**
 * Hook to detect light/dark theme from document root class
 */
export const useResolvedTheme = () => {
	const [theme, setTheme] = useState<"light" | "dark">("light");

	useEffect(() => {
		const root = document.documentElement;
		const updateTheme = () => {
			setTheme(root.classList.contains("dark") ? "dark" : "light");
		};

		updateTheme();
		const observer = new MutationObserver(() => updateTheme());
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	return theme;
};

/**
 * Normalize code for display (replace tabs with spaces, ensure non-empty)
 */
export const normalizeCode = (code: string) => {
	const trimmed = code.replace(/\t/g, "  ");
	return trimmed.length > 0 ? trimmed : " ";
};

/**
 * Get gruvbox theme based on mode
 */
export const getGruvboxTheme = (mode: "light" | "dark") =>
	mode === "dark" ? themes.gruvboxMaterialDark : themes.gruvboxMaterialLight;

const prismLanguageFallbacks: Record<string, string[]> = {
	astro: ["tsx", "jsx", "markup"],
	bash: ["python"],
	csharp: ["clike", "c"],
	java: ["clike"],
	mdx: ["jsx", "markdown"],
	php: ["markup", "html"],
	ruby: ["python"],
	scss: ["css"],
	toml: ["yaml"],
	vue: ["markup", "html", "xml"],
};

/**
 * Resolve a prism language that is actually available in bundled grammars
 */
export const resolvePrismLanguage = (language: string): Language => {
	const normalized = language.trim().toLowerCase();
	const candidates = [
		normalized,
		...(prismLanguageFallbacks[normalized] ?? []),
		"text",
	];
	const resolved = candidates.find((candidate) => Prism.languages[candidate]);
	return (resolved ?? "text") as Language;
};
