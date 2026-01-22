import { useChatStore } from "@remote-claude/core/stores";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import {
	ActivityIndicator,
	Button,
	SegmentedButtons,
	Text,
	TextInput,
	useTheme,
} from "react-native-paper";
import { useGateway } from "@/context/gateway-context";

export default function CreateSessionScreen() {
	const theme = useTheme();
	const router = useRouter();
	const { t } = useTranslation();
	const { apiClient, connectionStatus } = useGateway();

	const [title, setTitle] = useState("");
	const [cwd, setCwd] = useState("");
	const [selectedBackendId, setSelectedBackendId] = useState<string>("");

	const createLocalSession = useChatStore((state) => state.createLocalSession);
	const setActiveSessionId = useChatStore((state) => state.setActiveSessionId);
	const setLastCreatedCwd = useChatStore((state) => state.setLastCreatedCwd);
	const lastCreatedCwd = useChatStore((state) => state.lastCreatedCwd);

	// Fetch backends
	const { data: backendsData, isLoading: isLoadingBackends } = useQuery({
		queryKey: ["backends"],
		queryFn: apiClient.fetchAcpBackends,
		enabled: connectionStatus === "connected",
	});

	const backends = backendsData?.backends ?? [];
	const defaultBackendId =
		backendsData?.defaultBackendId || backends[0]?.backendId;

	// Set default backend when loaded
	if (!selectedBackendId && defaultBackendId) {
		setSelectedBackendId(defaultBackendId);
	}

	// Set default cwd from last created
	if (!cwd && lastCreatedCwd) {
		setCwd(lastCreatedCwd);
	}

	// Create session mutation
	const createSessionMutation = useMutation({
		mutationFn: apiClient.createSession,
		onSuccess: (data) => {
			createLocalSession(data.sessionId, {
				title: data.title,
				state: data.state,
				backendId: data.backendId,
				backendLabel: data.backendLabel,
				cwd: data.cwd,
				agentName: data.agentName,
				modelId: data.modelId,
				modelName: data.modelName,
				modeId: data.modeId,
				modeName: data.modeName,
				availableModes: data.availableModes,
				availableModels: data.availableModels,
				availableCommands: data.availableCommands,
			});

			setActiveSessionId(data.sessionId);
			setLastCreatedCwd(data.cwd);

			router.replace(`/session/${data.sessionId}`);
		},
	});

	const handleCreate = () => {
		if (!selectedBackendId) return;

		createSessionMutation.mutate({
			title: title.trim() || undefined,
			cwd: cwd.trim() || undefined,
			backendId: selectedBackendId,
		});
	};

	if (connectionStatus !== "connected") {
		return (
			<View style={[styles.container, styles.centered]}>
				<Text
					variant="bodyLarge"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("mobile.disconnected")}
				</Text>
			</View>
		);
	}

	return (
		<ScrollView style={styles.container}>
			<View style={styles.content}>
				<Text variant="headlineSmall" style={styles.title}>
					{t("session.createTitle")}
				</Text>
				<Text
					variant="bodyMedium"
					style={[styles.description, { color: theme.colors.onSurfaceVariant }]}
				>
					{t("session.createDescription")}
				</Text>

				<View style={styles.field}>
					<Text variant="labelLarge" style={styles.label}>
						{t("session.backendLabel")}
					</Text>
					{isLoadingBackends ? (
						<ActivityIndicator />
					) : backends.length === 0 ? (
						<Text style={{ color: theme.colors.error }}>
							{t("session.backendEmpty")}
						</Text>
					) : (
						<SegmentedButtons
							value={selectedBackendId}
							onValueChange={setSelectedBackendId}
							buttons={backends.map((backend) => ({
								value: backend.backendId,
								label: backend.backendLabel,
							}))}
							style={styles.segmentedButtons}
						/>
					)}
				</View>

				<View style={styles.field}>
					<Text variant="labelLarge" style={styles.label}>
						{t("session.titleLabel")}
					</Text>
					<TextInput
						mode="outlined"
						value={title}
						onChangeText={setTitle}
						placeholder={t("session.titlePlaceholder")}
					/>
				</View>

				<View style={styles.field}>
					<Text variant="labelLarge" style={styles.label}>
						{t("session.cwdLabel")}
					</Text>
					<TextInput
						mode="outlined"
						value={cwd}
						onChangeText={setCwd}
						placeholder={t("session.cwdPlaceholder")}
						autoCapitalize="none"
						autoCorrect={false}
					/>
				</View>

				{createSessionMutation.error && (
					<Text style={[styles.error, { color: theme.colors.error }]}>
						{createSessionMutation.error instanceof Error
							? createSessionMutation.error.message
							: t("errors.createSessionFailed")}
					</Text>
				)}

				<View style={styles.buttons}>
					<Button
						mode="outlined"
						onPress={() => router.back()}
						style={styles.button}
					>
						{t("common.cancel")}
					</Button>
					<Button
						mode="contained"
						onPress={handleCreate}
						loading={createSessionMutation.isPending}
						disabled={!selectedBackendId || createSessionMutation.isPending}
						style={styles.button}
					>
						{createSessionMutation.isPending
							? t("common.creating")
							: t("common.create")}
					</Button>
				</View>
			</View>
		</ScrollView>
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
	content: {
		padding: 16,
	},
	title: {
		marginBottom: 8,
	},
	description: {
		marginBottom: 24,
	},
	field: {
		marginBottom: 20,
	},
	label: {
		marginBottom: 8,
	},
	segmentedButtons: {
		marginTop: 4,
	},
	error: {
		marginBottom: 16,
	},
	buttons: {
		flexDirection: "row",
		gap: 12,
		marginTop: 24,
	},
	button: {
		flex: 1,
	},
});
