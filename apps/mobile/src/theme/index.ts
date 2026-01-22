import {
	DarkTheme as NavigationDarkTheme,
	DefaultTheme as NavigationDefaultTheme,
} from "@react-navigation/native";
import {
	adaptNavigationTheme,
	MD3DarkTheme,
	MD3LightTheme,
	type MD3Theme,
} from "react-native-paper";

const { LightTheme, DarkTheme } = adaptNavigationTheme({
	reactNavigationLight: NavigationDefaultTheme,
	reactNavigationDark: NavigationDarkTheme,
});

export const lightTheme: MD3Theme = {
	...MD3LightTheme,
	colors: {
		...MD3LightTheme.colors,
		...LightTheme.colors,
		primary: "#2563eb",
		primaryContainer: "#dbeafe",
		secondary: "#64748b",
		secondaryContainer: "#e2e8f0",
		surface: "#ffffff",
		surfaceVariant: "#f8fafc",
		background: "#ffffff",
		error: "#ef4444",
		errorContainer: "#fee2e2",
		onPrimary: "#ffffff",
		onSecondary: "#ffffff",
		onSurface: "#0f172a",
		onSurfaceVariant: "#475569",
		onBackground: "#0f172a",
		outline: "#e2e8f0",
		outlineVariant: "#f1f5f9",
	},
};

export const darkTheme: MD3Theme = {
	...MD3DarkTheme,
	colors: {
		...MD3DarkTheme.colors,
		...DarkTheme.colors,
		primary: "#3b82f6",
		primaryContainer: "#1e3a5f",
		secondary: "#94a3b8",
		secondaryContainer: "#334155",
		surface: "#0f172a",
		surfaceVariant: "#1e293b",
		background: "#0a0a0a",
		error: "#f87171",
		errorContainer: "#7f1d1d",
		onPrimary: "#ffffff",
		onSecondary: "#0f172a",
		onSurface: "#f8fafc",
		onSurfaceVariant: "#cbd5e1",
		onBackground: "#f8fafc",
		outline: "#334155",
		outlineVariant: "#1e293b",
	},
};

export type AppTheme = typeof lightTheme;
