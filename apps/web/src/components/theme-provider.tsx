import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/ui-config";

type ThemeProviderProps = {
	children: React.ReactNode;
	defaultTheme?: ThemePreference;
	storageKey?: string;
};

type ThemeProviderState = {
	theme: ThemePreference;
	setTheme: (theme: ThemePreference) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
	undefined,
);

const resolveTheme = (
	value: string | null,
	fallback: ThemePreference,
): ThemePreference => {
	if (value === "light" || value === "dark" || value === "system") {
		return value;
	}
	return fallback;
};

export function ThemeProvider({
	children,
	defaultTheme = "system",
	storageKey,
}: ThemeProviderProps) {
	const resolvedStorageKey = useMemo(
		() => storageKey ?? THEME_STORAGE_KEY,
		[storageKey],
	);
	const [theme, setThemeState] = useState<ThemePreference>(() => {
		if (typeof window === "undefined") {
			return defaultTheme;
		}
		const storedTheme = window.localStorage.getItem(resolvedStorageKey);
		return resolveTheme(storedTheme, defaultTheme);
	});

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const root = window.document.documentElement;
		const mediaQuery =
			window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;

		const applyTheme = (prefersDark: boolean) => {
			root.classList.remove("light", "dark");
			if (theme === "system") {
				root.classList.add(prefersDark ? "dark" : "light");
				return;
			}
			root.classList.add(theme);
		};

		applyTheme(mediaQuery?.matches ?? false);

		const handleChange = (event: MediaQueryListEvent) => {
			if (theme === "system") {
				applyTheme(event.matches);
			}
		};

		if (!mediaQuery) {
			return;
		}

		mediaQuery.addEventListener("change", handleChange);
		return () => {
			mediaQuery.removeEventListener("change", handleChange);
		};
	}, [theme]);

	const setTheme = useCallback(
		(nextTheme: ThemePreference) => {
			if (typeof window !== "undefined") {
				if (nextTheme === "system") {
					window.localStorage.removeItem(resolvedStorageKey);
				} else {
					window.localStorage.setItem(resolvedStorageKey, nextTheme);
				}
			}
			setThemeState(nextTheme);
		},
		[resolvedStorageKey],
	);

	const value = useMemo(
		() => ({
			theme,
			setTheme,
		}),
		[setTheme, theme],
	);

	return (
		<ThemeProviderContext.Provider value={value}>
			{children}
		</ThemeProviderContext.Provider>
	);
}

export const useTheme = () => {
	const context = useContext(ThemeProviderContext);

	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}

	return context;
};
