export const THEME_STORAGE_KEY = "mobvibe-theme";
export const MACHINE_SIDEBAR_WIDTH_KEY = "mobvibe.sidebar.machineWidth";
export const SESSION_SIDEBAR_WIDTH_KEY = "mobvibe.sidebar.sessionWidth";

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
