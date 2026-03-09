import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandLogo } from "@/components/brand-logo";
import { THEME_STORAGE_KEY } from "@/lib/ui-config";

const setMatchMedia = (matches: boolean) => {
	const listeners = new Set<() => void>();
	const mediaQueryList = {
		matches,
		media: "(prefers-color-scheme: dark)",
		addEventListener: (_: string, listener: () => void) => {
			listeners.add(listener);
		},
		removeEventListener: (_: string, listener: () => void) => {
			listeners.delete(listener);
		},
		dispatch: (nextMatches: boolean) => {
			mediaQueryList.matches = nextMatches;
			for (const listener of listeners) {
				listener();
			}
		},
	};

	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn(() => mediaQueryList),
	});

	return mediaQueryList;
};

describe("BrandLogo", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.classList.remove("light", "dark");
	});

	it("uses the light logo by default", () => {
		setMatchMedia(false);

		render(<BrandLogo alt="Mobvibe" />);

		expect(screen.getByAltText("Mobvibe")).toHaveAttribute(
			"src",
			"/logo-light.svg",
		);
	});

	it("uses the stored theme before the root class is applied", () => {
		localStorage.setItem(THEME_STORAGE_KEY, "dark");
		setMatchMedia(false);

		render(<BrandLogo alt="Mobvibe" />);

		expect(screen.getByAltText("Mobvibe")).toHaveAttribute(
			"src",
			"/logo-dark.svg",
		);
	});

	it("tracks root theme changes", async () => {
		const mediaQuery = setMatchMedia(false);

		render(<BrandLogo alt="Mobvibe" />);
		act(() => {
			document.documentElement.classList.add("dark");
		});

		await waitFor(() => {
			expect(screen.getByAltText("Mobvibe")).toHaveAttribute(
				"src",
				"/logo-dark.svg",
			);
		});

		act(() => {
			document.documentElement.classList.remove("dark");
			document.documentElement.classList.add("light");
			mediaQuery.dispatch(false);
		});

		await waitFor(() => {
			expect(screen.getByAltText("Mobvibe")).toHaveAttribute(
				"src",
				"/logo-light.svg",
			);
		});
	});
});
