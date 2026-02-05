import { themes } from "prism-react-renderer";
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
