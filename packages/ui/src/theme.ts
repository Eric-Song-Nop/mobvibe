export const THEME_STORAGE_KEY = "mobvibe-theme";

export type ThemePreference = "light" | "dark" | "system";

export const toThemePreference = (value: string): ThemePreference => {
	switch (value) {
		case "light":
		case "dark":
		case "system":
			return value;
		default:
			return "system";
	}
};
