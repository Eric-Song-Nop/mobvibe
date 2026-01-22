import { useMachinesStore } from "@remote-claude/core/stores";
import { useTranslation } from "react-i18next";
import { FlatList, StyleSheet, View } from "react-native";
import { Avatar, Card, Chip, Text, useTheme } from "react-native-paper";
import { useGateway } from "@/context/gateway-context";

export default function MachinesScreen() {
	const theme = useTheme();
	const { t } = useTranslation();
	const { connectionStatus } = useGateway();
	const machines = useMachinesStore((state) => state.machines);

	const machineList = Object.values(machines);

	const renderMachine = ({ item }: { item: (typeof machineList)[0] }) => (
		<Card style={styles.card} mode="outlined">
			<Card.Content style={styles.cardContent}>
				<Avatar.Icon
					size={40}
					icon="laptop"
					style={{
						backgroundColor: item.connected
							? theme.colors.primaryContainer
							: theme.colors.surfaceVariant,
					}}
				/>
				<View style={styles.machineInfo}>
					<Text variant="titleMedium">
						{item.hostname || item.machineId.slice(0, 8)}
					</Text>
					<View style={styles.statusRow}>
						<Chip
							compact
							textStyle={{ fontSize: 10 }}
							style={[
								styles.stateChip,
								{
									backgroundColor: item.connected
										? theme.colors.primaryContainer
										: theme.colors.surfaceVariant,
								},
							]}
						>
							{item.connected ? t("machines.online") : t("machines.offline")}
						</Chip>
						{item.sessionCount !== undefined && item.sessionCount > 0 && (
							<Text
								variant="bodySmall"
								style={{ color: theme.colors.onSurfaceVariant, marginLeft: 8 }}
							>
								{t("machines.sessions", { count: item.sessionCount })}
							</Text>
						)}
					</View>
				</View>
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
			</View>
		);
	}

	return (
		<View style={styles.container}>
			<FlatList
				data={machineList}
				keyExtractor={(item) => item.machineId}
				renderItem={renderMachine}
				contentContainerStyle={styles.list}
				ListEmptyComponent={
					<View style={styles.empty}>
						<Text
							variant="bodyLarge"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("machines.empty")}
						</Text>
					</View>
				}
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
	},
	card: {
		marginBottom: 12,
	},
	cardContent: {
		flexDirection: "row",
		alignItems: "center",
	},
	machineInfo: {
		marginLeft: 16,
		flex: 1,
	},
	statusRow: {
		flexDirection: "row",
		alignItems: "center",
		marginTop: 4,
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
});
