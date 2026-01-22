import {
	setDefaultTitleGetter,
	setSessionClosedMessageGetter,
	setStorageAdapter,
} from "@remote-claude/core/stores";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GatewayProvider } from "@/context/gateway-context";
import { i18n, initI18n } from "@/lib/i18n";
import { createInMemoryStorageAdapter } from "@/lib/storage-adapter";
import { darkTheme, lightTheme } from "@/theme";

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Create query client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 5000,
			retry: 2,
		},
	},
});

// Configure core package storage
setStorageAdapter(createInMemoryStorageAdapter());

export default function RootLayout() {
	const colorScheme = useColorScheme();
	const [isReady, setIsReady] = useState(false);

	const theme = colorScheme === "dark" ? darkTheme : lightTheme;

	useEffect(() => {
		const prepare = async () => {
			try {
				// Initialize i18n
				await initI18n();

				// Configure i18n-dependent getters
				setDefaultTitleGetter(() => i18n.t("session.defaultTitle"));
				setSessionClosedMessageGetter(() => i18n.t("session.sessionClosed"));

				setIsReady(true);
			} catch (error) {
				console.error("Failed to initialize app:", error);
				setIsReady(true);
			}
		};

		prepare();
	}, []);

	const onLayoutRootView = useCallback(async () => {
		if (isReady) {
			await SplashScreen.hideAsync();
		}
	}, [isReady]);

	if (!isReady) {
		return (
			<View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
				<ActivityIndicator size="large" />
			</View>
		);
	}

	return (
		<GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
			<SafeAreaProvider>
				<QueryClientProvider client={queryClient}>
					<PaperProvider theme={theme}>
						<GatewayProvider>
							<StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
							<Stack
								screenOptions={{
									headerShown: false,
									contentStyle: {
										backgroundColor: theme.colors.background,
									},
								}}
							>
								<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
								<Stack.Screen
									name="settings"
									options={{
										headerShown: true,
										title: i18n.t("mobile.settings"),
										presentation: "modal",
									}}
								/>
								<Stack.Screen
									name="session/[id]"
									options={{
										headerShown: true,
										title: "",
									}}
								/>
								<Stack.Screen
									name="session/create"
									options={{
										headerShown: true,
										title: i18n.t("session.createTitle"),
										presentation: "modal",
									}}
								/>
							</Stack>
						</GatewayProvider>
					</PaperProvider>
				</QueryClientProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
