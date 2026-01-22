import type { SessionSummary } from "@remote-claude/core/api";
import { useChatStore } from "@remote-claude/core/stores";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import {
	ActivityIndicator,
	Card,
	Chip,
	FAB,
	Text,
	useTheme,
} from "react-native-paper";
import { useGateway } from "@/context/gateway-context";

export default function SessionsScreen() {
	const theme = useTheme();
	const router = useRouter();
	const { t } = useTranslation();
	const { apiClient, connectionStatus } = useGateway();

	const sessions = useChatStore((state) => state.sessions);
	const setActiveSessionId = useChatStore((state) => state.setActiveSessionId);
	const syncSessions = useChatStore((state) => state.syncSessions);

	const {
		data: sessionsData,
		isLoading,
		refetch,
		isRefetching,
	} = useQuery({
		queryKey: ["sessions"],
		queryFn: apiClient.fetchSessions,
		refetchInterval: 5000,
		enabled: connectionStatus === "connected",
	});

	// Sync sessions to store when data changes
	useEffect(() => {
		if (sessionsData?.sessions) {
			syncSessions(sessionsData.sessions);
		}
	}, [sessionsData, syncSessions]);

	const handleSessionPress = (sessionId: string) => {
		setActiveSessionId(sessionId);
		router.push(`/session/${sessionId}`);
	};

	const handleCreateSession = () => {
		router.push("/session/create");
	};

	const getStateColor = (state: SessionSummary["state"] | undefined) => {
		switch (state) {
			case "ready":
				return theme.colors.primary;
			case "connecting":
				return theme.colors.secondary;
			case "error":
				return theme.colors.error;
			case "stopped":
				return theme.colors.outline;
			default:
				return theme.colors.onSurfaceVariant;
		}
	};

	const getStateLabel = (state: SessionSummary["state"] | undefined) => {
		switch (state) {
			case "ready":
				return t("status.ready");
			case "connecting":
				return t("status.connecting");
			case "error":
				return t("status.error");
			case "stopped":
				return t("status.stopped");
			case "idle":
				return t("status.idle");
			default:
				return t("common.unknown");
		}
	};

	const sessionList = Object.values(sessions).sort((a, b) => {
		const dateA = a.updatedAt || a.createdAt || "";
		const dateB = b.updatedAt || b.createdAt || "";
		return dateB.localeCompare(dateA);
	});

	const renderSession = ({ item }: { item: (typeof sessionList)[0] }) => (
		<Card
			style={styles.card}
			onPress={() => handleSessionPress(item.sessionId)}
			mode="outlined"
		>
			<Card.Content>
				<View style={styles.cardHeader}>
					<Text variant="titleMedium" numberOfLines={1} style={styles.title}>
						{item.title}
					</Text>
					<Chip
						compact
						textStyle={{ fontSize: 10 }}
						style={[
							styles.stateChip,
							{ backgroundColor: getStateColor(item.state) + "20" },
						]}
					>
						{getStateLabel(item.state)}
					</Chip>
				</View>
				{item.backendLabel && (
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{item.backendLabel}
					</Text>
				)}
				{item.cwd && (
					<Text
						variant="bodySmall"
						numberOfLines={1}
						style={{ color: theme.colors.outline }}
					>
						{item.cwd}
					</Text>
				)}
			</Card.Content>
		</Card>
	);

	if (connectionStatus !== "connected") {
		return (
			<View style={[styles.container, styles.centered]}>
				<Text
					variant="bodyLarge"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{connectionStatus === "connecting"
						? t("mobile.connecting")
						: t("mobile.disconnected")}
				</Text>
				{connectionStatus === "connecting" && (
					<ActivityIndicator style={{ marginTop: 16 }} />
				)}
			</View>
		);
	}

	if (isLoading && sessionList.length === 0) {
		return (
			<View style={[styles.container, styles.centered]}>
				<ActivityIndicator size="large" />
			</View>
		);
	}

	return (
		<View style={styles.container}>
			<FlatList
				data={sessionList}
				keyExtractor={(item) => item.sessionId}
				renderItem={renderSession}
				contentContainerStyle={styles.list}
				refreshControl={
					<RefreshControl
						refreshing={isRefetching}
						onRefresh={refetch}
						tintColor={theme.colors.primary}
					/>
				}
				ListEmptyComponent={
					<View style={styles.empty}>
						<Text
							variant="bodyLarge"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("session.empty")}
						</Text>
					</View>
				}
			/>
			<FAB
				icon="plus"
				style={[styles.fab, { backgroundColor: theme.colors.primary }]}
				color={theme.colors.onPrimary}
				onPress={handleCreateSession}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	centered: {
		justifyContent: "center",
		alignItems: "center",
	},
	list: {
		padding: 16,
		paddingBottom: 100,
	},
	card: {
		marginBottom: 12,
	},
	cardHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 4,
	},
	title: {
		flex: 1,
		marginRight: 8,
	},
	stateChip: {
		height: 24,
	},
	empty: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingTop: 100,
	},
	fab: {
		position: "absolute",
		margin: 16,
		right: 0,
		bottom: 0,
	},
});
