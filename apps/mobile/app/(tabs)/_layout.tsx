import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "react-native-paper";

export default function TabsLayout() {
	const theme = useTheme();
	const { t } = useTranslation();

	return (
		<Tabs
			screenOptions={{
				headerShown: true,
				tabBarActiveTintColor: theme.colors.primary,
				tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
				tabBarStyle: {
					backgroundColor: theme.colors.surface,
					borderTopColor: theme.colors.outlineVariant,
				},
				headerStyle: {
					backgroundColor: theme.colors.surface,
				},
				headerTintColor: theme.colors.onSurface,
			}}
		>
			<Tabs.Screen
				name="index"
				options={{
					title: t("session.title"),
					tabBarIcon: ({ color, size }) => (
						<Ionicons name="chatbubbles-outline" size={size} color={color} />
					),
				}}
			/>
			<Tabs.Screen
				name="machines"
				options={{
					title: t("machines.title"),
					tabBarIcon: ({ color, size }) => (
						<Ionicons name="hardware-chip-outline" size={size} color={color} />
					),
				}}
			/>
			<Tabs.Screen
				name="settings"
				options={{
					title: t("mobile.settings"),
					tabBarIcon: ({ color, size }) => (
						<Ionicons name="settings-outline" size={size} color={color} />
					),
				}}
			/>
		</Tabs>
	);
}
