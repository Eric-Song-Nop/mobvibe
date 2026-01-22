import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import {
	Button,
	Dialog,
	Divider,
	List,
	Portal,
	RadioButton,
	Text,
	TextInput,
	useTheme,
} from "react-native-paper";
import { useGateway } from "@/context/gateway-context";
import { changeLanguage, i18n } from "@/lib/i18n";

export default function SettingsScreen() {
	const theme = useTheme();
	const { t } = useTranslation();
	const { gatewayUrl, setGatewayUrl, connectionStatus, connect, disconnect } =
		useGateway();

	const [urlInput, setUrlInput] = useState(gatewayUrl);
	const [languageDialogVisible, setLanguageDialogVisible] = useState(false);
	const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);

	const handleSaveUrl = async () => {
		await setGatewayUrl(urlInput);
		disconnect();
		connect();
	};

	const handleLanguageChange = async (language: string) => {
		setSelectedLanguage(language);
		await changeLanguage(language);
		setLanguageDialogVisible(false);
	};

	const getConnectionStatusColor = () => {
		switch (connectionStatus) {
			case "connected":
				return theme.colors.primary;
			case "connecting":
				return theme.colors.secondary;
			case "error":
				return theme.colors.error;
			default:
				return theme.colors.outline;
		}
	};

	const getConnectionStatusLabel = () => {
		switch (connectionStatus) {
			case "connected":
				return t("mobile.connected");
			case "connecting":
				return t("mobile.connecting");
			case "error":
				return t("status.error");
			default:
				return t("mobile.disconnected");
		}
	};

	return (
		<ScrollView style={styles.container}>
			<View style={styles.section}>
				<Text
					variant="titleMedium"
					style={[styles.sectionTitle, { color: theme.colors.primary }]}
				>
					{t("mobile.gatewayUrl")}
				</Text>

				<TextInput
					mode="outlined"
					value={urlInput}
					onChangeText={setUrlInput}
					placeholder={t("mobile.gatewayUrlPlaceholder")}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
					style={styles.input}
				/>

				<View style={styles.connectionStatus}>
					<View
						style={[
							styles.statusDot,
							{ backgroundColor: getConnectionStatusColor() },
						]}
					/>
					<Text
						variant="bodyMedium"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{getConnectionStatusLabel()}
					</Text>
				</View>

				<View style={styles.buttonRow}>
					<Button
						mode="contained"
						onPress={handleSaveUrl}
						style={styles.button}
					>
						{t("common.save")}
					</Button>
					{connectionStatus === "connected" ? (
						<Button mode="outlined" onPress={disconnect} style={styles.button}>
							{t("mobile.disconnect")}
						</Button>
					) : (
						<Button
							mode="outlined"
							onPress={connect}
							style={styles.button}
							loading={connectionStatus === "connecting"}
						>
							{t("mobile.connect")}
						</Button>
					)}
				</View>
			</View>

			<Divider />

			<View style={styles.section}>
				<Text
					variant="titleMedium"
					style={[styles.sectionTitle, { color: theme.colors.primary }]}
				>
					{t("common.language")}
				</Text>

				<List.Item
					title={t("languageSwitcher.chooseLanguage")}
					description={t(`common.languages.${selectedLanguage}`)}
					onPress={() => setLanguageDialogVisible(true)}
					right={(props) => <List.Icon {...props} icon="chevron-right" />}
				/>
			</View>

			<Portal>
				<Dialog
					visible={languageDialogVisible}
					onDismiss={() => setLanguageDialogVisible(false)}
				>
					<Dialog.Title>{t("languageSwitcher.chooseLanguage")}</Dialog.Title>
					<Dialog.Content>
						<RadioButton.Group
							onValueChange={handleLanguageChange}
							value={selectedLanguage}
						>
							<RadioButton.Item label={t("common.languages.en")} value="en" />
							<RadioButton.Item label={t("common.languages.zh")} value="zh" />
						</RadioButton.Group>
					</Dialog.Content>
				</Dialog>
			</Portal>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	section: {
		padding: 16,
	},
	sectionTitle: {
		marginBottom: 16,
	},
	input: {
		marginBottom: 12,
	},
	connectionStatus: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 16,
	},
	statusDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		marginRight: 8,
	},
	buttonRow: {
		flexDirection: "row",
		gap: 12,
	},
	button: {
		flex: 1,
	},
});
