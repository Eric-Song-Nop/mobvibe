import { type ComponentPropsWithoutRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type BrandLogoProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "src"> & {
	alt: string;
};

const THEME_STORAGE_KEY = "mobvibe-theme";

const resolveTheme = () => {
	if (typeof window === "undefined") {
		return "light" as const;
	}

	const root = window.document.documentElement;
	if (root.classList.contains("dark")) {
		return "dark" as const;
	}
	if (root.classList.contains("light")) {
		return "light" as const;
	}

	const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (storedTheme === "dark" || storedTheme === "light") {
		return storedTheme;
	}

	return window.matchMedia?.("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
};

export function BrandLogo({
	alt,
	className,
	height = 256,
	width = 256,
	...props
}: BrandLogoProps) {
	const [theme, setTheme] = useState<"light" | "dark">(() => resolveTheme());

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const root = window.document.documentElement;
		const mediaQuery =
			window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
		const updateTheme = () => {
			setTheme(resolveTheme());
		};

		updateTheme();

		const observer = new MutationObserver(() => {
			updateTheme();
		});
		observer.observe(root, {
			attributes: true,
			attributeFilter: ["class"],
		});
		mediaQuery?.addEventListener("change", updateTheme);
		window.addEventListener("storage", updateTheme);

		return () => {
			observer.disconnect();
			mediaQuery?.removeEventListener("change", updateTheme);
			window.removeEventListener("storage", updateTheme);
		};
	}, []);

	return (
		<img
			{...props}
			src={theme === "dark" ? "/logo-dark.svg" : "/logo-light.svg"}
			alt={alt}
			className={cn("shrink-0", className)}
			data-slot="brand-logo"
			height={height}
			width={width}
		/>
	);
}
