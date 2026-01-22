import {
	type ChatMessage,
	type ChatSession,
	useChatStore,
} from "@remote-claude/core/stores";
import { createDefaultContentBlocks } from "@remote-claude/core/utils";
import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	FlatList,
	KeyboardAvoidingView,
	Platform,
	StyleSheet,
	View,
} from "react-native";
import {
	ActivityIndicator,
	Chip,
	IconButton,
	Surface,
	Text,
	TextInput,
	useTheme,
} from "react-native-paper";
import { useGateway } from "@/context/gateway-context";

export default function SessionScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const theme = useTheme();
	const { t } = useTranslation();
	const navigation = useNavigation();
	const { apiClient, connectionStatus } = useGateway();
	const flatListRef = useRef<FlatList>(null);

	const session = useChatStore(
		(state) => (id ? state.sessions[id] : undefined) as ChatSession | undefined,
	);
	const setInput = useChatStore((state) => state.setInput);
	const setInputContents = useChatStore((state) => state.setInputContents);
	const setSending = useChatStore((state) => state.setSending);
	const addUserMessage = useChatStore((state) => state.addUserMessage);
	const finalizeAssistantMessage = useChatStore(
		(state) => state.finalizeAssistantMessage,
	);
	const addStatusMessage = useChatStore((state) => state.addStatusMessage);
	const setCanceling = useChatStore((state) => state.setCanceling);

	// Update navigation title
	useEffect(() => {
		if (session?.title) {
			navigation.setOptions({ title: session.title });
		}
	}, [session?.title, navigation]);

	// Send message mutation
	const sendMessageMutation = useMutation({
		mutationFn: apiClient.sendMessage,
		onSuccess: (data) => {
			if (id) {
				finalizeAssistantMessage(id);
				setSending(id, false);
			}
		},
		onError: (error) => {
			if (id) {
				finalizeAssistantMessage(id);
				setSending(id, false);
			}
		},
	});

	// Create message ID mutation
	const createMessageIdMutation = useMutation({
		mutationFn: apiClient.createMessageId,
	});

	// Cancel session mutation
	const cancelSessionMutation = useMutation({
		mutationFn: apiClient.cancelSession,
		onSuccess: () => {
			if (id) {
				addStatusMessage(id, {
					title: t("statusMessages.cancelled"),
					variant: "warning",
				});
				finalizeAssistantMessage(id);
				setSending(id, false);
				setCanceling(id, false);
			}
		},
		onError: () => {
			if (id) {
				setCanceling(id, false);
			}
		},
	});

	const handleSend = useCallback(async () => {
		if (!id || !session || !session.input.trim() || session.sending) return;

		const messageText = session.input.trim();
		const contentBlocks =
			session.inputContents.length > 0
				? session.inputContents
				: createDefaultContentBlocks(messageText);

		// Clear input
		setInput(id, "");
		setInputContents(id, createDefaultContentBlocks(""));
		setSending(id, true);

		try {
			// Get message ID
			const { messageId } = await createMessageIdMutation.mutateAsync({
				sessionId: id,
			});

			// Add user message to store
			addUserMessage(id, messageText, {
				messageId,
				contentBlocks,
			});

			// Send message
			await sendMessageMutation.mutateAsync({
				sessionId: id,
				prompt: contentBlocks,
			});
		} catch (error) {
			console.error("Failed to send message:", error);
			setSending(id, false);
		}
	}, [
		id,
		session,
		setInput,
		setInputContents,
		setSending,
		addUserMessage,
		createMessageIdMutation,
		sendMessageMutation,
	]);

	const handleCancel = useCallback(() => {
		if (!id || !session?.sending || session.canceling) return;
		setCanceling(id, true);
		cancelSessionMutation.mutate({ sessionId: id });
	}, [id, session, setCanceling, cancelSessionMutation]);

	// Auto-scroll to bottom when messages change
	useEffect(() => {
		if (session?.messages.length) {
			setTimeout(() => {
				flatListRef.current?.scrollToEnd({ animated: true });
			}, 100);
		}
	}, [session?.messages.length]);

	const renderMessage = ({ item }: { item: ChatMessage }) => {
		const isUser = item.role === "user";

		if (item.kind === "text" || !item.kind) {
			return (
				<View
					style={[
						styles.messageContainer,
						isUser ? styles.userMessage : styles.assistantMessage,
					]}
				>
					<Surface
						style={[
							styles.messageBubble,
							{
								backgroundColor: isUser
									? theme.colors.primaryContainer
									: theme.colors.surfaceVariant,
							},
						]}
						elevation={0}
					>
						<Text
							style={{
								color: isUser
									? theme.colors.onPrimaryContainer
									: theme.colors.onSurfaceVariant,
							}}
						>
							{item.content}
						</Text>
						{item.isStreaming && (
							<ActivityIndicator
								size="small"
								style={{ marginTop: 8 }}
								color={theme.colors.primary}
							/>
						)}
					</Surface>
				</View>
			);
		}

		if (item.kind === "status") {
			return (
				<View style={styles.statusMessage}>
					<Chip
						compact
						icon={
							item.variant === "warning"
								? "alert-circle-outline"
								: item.variant === "error"
									? "close-circle-outline"
									: "information-outline"
						}
					>
						{item.title}
					</Chip>
				</View>
			);
		}

		if (item.kind === "tool_call") {
			return (
				<View style={styles.toolCallMessage}>
					<Surface
						style={[
							styles.toolCallBubble,
							{ backgroundColor: theme.colors.surfaceVariant },
						]}
						elevation={0}
					>
						<View style={styles.toolCallHeader}>
							<Text
								variant="labelSmall"
								style={{ color: theme.colors.outline }}
							>
								{item.title || item.name || t("toolCall.toolCall")}
							</Text>
							{item.status && (
								<Chip compact textStyle={{ fontSize: 10 }}>
									{t(
										`toolCall.status${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`,
									)}
								</Chip>
							)}
						</View>
						{item.command && (
							<Text
								variant="bodySmall"
								style={{
									fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
									color: theme.colors.onSurfaceVariant,
								}}
								numberOfLines={3}
							>
								{item.command}
							</Text>
						)}
					</Surface>
				</View>
			);
		}

		if (item.kind === "permission") {
			return (
				<View style={styles.permissionMessage}>
					<Surface
						style={[
							styles.permissionBubble,
							{ backgroundColor: theme.colors.tertiaryContainer },
						]}
						elevation={0}
					>
						<Text
							variant="labelMedium"
							style={{ color: theme.colors.onTertiaryContainer }}
						>
							{t("toolCall.permissionRequest")}
						</Text>
						{item.toolCall?.title && (
							<Text
								variant="bodySmall"
								style={{ color: theme.colors.onTertiaryContainer }}
							>
								{item.toolCall.title}
							</Text>
						)}
						{item.outcome ? (
							<Chip compact style={{ marginTop: 8 }}>
								{item.outcome.outcome === "cancelled"
									? t("toolCall.permissionDenied")
									: t("toolCall.permissionAllowed", {
											optionId: item.outcome.optionId,
										})}
							</Chip>
						) : (
							<View style={styles.permissionOptions}>
								{item.options.map((option) => (
									<Chip
										key={option.optionId}
										onPress={() => {
											// TODO: Handle permission decision
										}}
										style={{ marginRight: 8, marginTop: 8 }}
									>
										{option.label || option.optionId}
									</Chip>
								))}
							</View>
						)}
					</Surface>
				</View>
			);
		}

		return null;
	};

	if (!session) {
		return (
			<View style={[styles.container, styles.centered]}>
				<Text variant="bodyLarge" style={{ color: theme.colors.error }}>
					{t("errors.sessionUnavailable")}
				</Text>
			</View>
		);
	}

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
		<KeyboardAvoidingView
			style={styles.container}
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			keyboardVerticalOffset={100}
		>
			<FlatList
				ref={flatListRef}
				data={session.messages}
				keyExtractor={(item) => item.id}
				renderItem={renderMessage}
				contentContainerStyle={styles.messageList}
				ListEmptyComponent={
					<View style={styles.emptyList}>
						<Text
							variant="bodyMedium"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("chat.selectSession")}
						</Text>
					</View>
				}
			/>

			<Surface style={styles.inputContainer} elevation={2}>
				<TextInput
					mode="outlined"
					value={session.input}
					onChangeText={(text) => setInput(id, text)}
					placeholder={t("chat.placeholder")}
					multiline
					maxLength={10000}
					style={styles.input}
					disabled={session.sending || session.state !== "ready"}
					right={
						session.sending ? (
							<TextInput.Icon
								icon="stop"
								onPress={handleCancel}
								disabled={session.canceling}
							/>
						) : (
							<TextInput.Icon
								icon="send"
								onPress={handleSend}
								disabled={!session.input.trim() || session.state !== "ready"}
							/>
						)
					}
				/>
			</Surface>
		</KeyboardAvoidingView>
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
	messageList: {
		padding: 16,
		paddingBottom: 8,
	},
	emptyList: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingTop: 100,
	},
	messageContainer: {
		marginBottom: 12,
	},
	userMessage: {
		alignItems: "flex-end",
	},
	assistantMessage: {
		alignItems: "flex-start",
	},
	messageBubble: {
		maxWidth: "85%",
		padding: 12,
		borderRadius: 16,
	},
	statusMessage: {
		alignItems: "center",
		marginVertical: 8,
	},
	toolCallMessage: {
		alignItems: "flex-start",
		marginBottom: 12,
	},
	toolCallBubble: {
		maxWidth: "90%",
		padding: 12,
		borderRadius: 12,
	},
	toolCallHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 4,
	},
	permissionMessage: {
		alignItems: "flex-start",
		marginBottom: 12,
	},
	permissionBubble: {
		maxWidth: "90%",
		padding: 12,
		borderRadius: 12,
	},
	permissionOptions: {
		flexDirection: "row",
		flexWrap: "wrap",
	},
	inputContainer: {
		padding: 8,
		paddingBottom: Platform.OS === "ios" ? 24 : 8,
	},
	input: {
		maxHeight: 120,
	},
});
