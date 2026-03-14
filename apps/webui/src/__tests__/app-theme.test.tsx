import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/ui-config";

const ThemeSetter = ({ theme }: { theme: "light" | "dark" | "system" }) => {
	const { setTheme } = useTheme();

	useEffect(() => {
		setTheme(theme);
	}, [setTheme, theme]);

	return null;
};

const setMatchMedia = (matches: boolean) => {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const mediaQueryList = {
		matches,
		media: "(prefers-color-scheme: dark)",
		addEventListener: (
			_: string,
			listener: (event: MediaQueryListEvent) => void,
		) => {
			listeners.add(listener);
		},
		removeEventListener: (
			_: string,
			listener: (event: MediaQueryListEvent) => void,
		) => {
			listeners.delete(listener);
		},
		dispatch: (nextMatches: boolean) => {
			mediaQueryList.matches = nextMatches;
			listeners.forEach((listener) =>
				listener({ matches: nextMatches } as MediaQueryListEvent),
			);
		},
	};

	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn(() => mediaQueryList),
	});
	return mediaQueryList;
};

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove("light", "dark");
});

describe("App theme preference", () => {
	it("uses stored preference and updates root class", async () => {
		localStorage.setItem(THEME_STORAGE_KEY, "dark");
		setMatchMedia(false);

		render(
			<ThemeProvider>
				<div>theme</div>
			</ThemeProvider>,
		);

		await waitFor(() => {
			expect(document.documentElement.classList.contains("dark")).toBe(true);
		});
	});

	it("responds to system theme changes when in system mode", async () => {
		const mediaQueryList = setMatchMedia(false);

		render(
			<ThemeProvider>
				<div>theme</div>
			</ThemeProvider>,
		);

		await waitFor(() => {
			expect(document.documentElement.classList.contains("light")).toBe(true);
		});

		mediaQueryList.dispatch(true);

		await waitFor(() => {
			expect(document.documentElement.classList.contains("dark")).toBe(true);
		});
	});

	it("updates preference when theme changes", async () => {
		setMatchMedia(true);

		render(
			<ThemeProvider>
				<ThemeSetter theme="light" />
			</ThemeProvider>,
		);

		await waitFor(() => {
			expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
			expect(document.documentElement.classList.contains("dark")).toBe(false);
			expect(document.documentElement.classList.contains("light")).toBe(true);
		});
	});
});
