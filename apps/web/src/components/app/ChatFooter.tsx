import { ComputerIcon, SettingsIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandCombobox } from "@/components/app/CommandCombobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AvailableCommand } from "@/lib/acp";
import { type ChatSession, useChatStore } from "@/lib/chat-store";
import {
	buildCommandSearchItems,
	filterCommandItems,
} from "@/lib/command-utils";
import { MESSAGE_INPUT_ROWS } from "@/lib/ui-config";

export type ChatFooterProps = {
	activeSession?: ChatSession;
	activeSessionId: string | undefined;
	isModeSwitching: boolean;
	isModelSwitching: boolean;
	onModeChange: (modeId: string) => void;
	onModelChange: (modelId: string) => void;
	onSend: () => void;
	onCancel: () => void;
};

export function ChatFooter({
	activeSession,
	activeSessionId,
	isModeSwitching,
	isModelSwitching,
	onModeChange,
	onModelChange,
	onSend,
	onCancel,
}: ChatFooterProps) {
	const { setInput } = useChatStore();
	const { t } = useTranslation();
	const availableModels = activeSession?.availableModels ?? [];
	const availableModes = activeSession?.availableModes ?? [];
	const availableCommands = activeSession?.availableCommands ?? [];
	const modelLabel = activeSession?.modelName ?? activeSession?.modelId;
	const modeLabel = activeSession?.modeName ?? activeSession?.modeId;
	const isReady = activeSession?.state === "ready";
	const searchItems = useMemo(
		() => buildCommandSearchItems(availableCommands),
		[availableCommands],
	);
	const rawInput = activeSession?.input ?? "";
	const hasSlashPrefix = rawInput.startsWith("/");
	const slashInput = hasSlashPrefix ? rawInput.slice(1) : "";
	const commandQuery = hasSlashPrefix
		? (slashInput.trim().split(/\s+/)[0] ?? "")
		: "";
	const commandMatches = useMemo(
		() => filterCommandItems(searchItems, commandQuery),
		[commandQuery, searchItems],
	);
	const commandPickerDisabled = !activeSessionId || !isReady;
	const [commandHighlight, setCommandHighlight] = useState(0);
	const [commandPickerSuppressed, setCommandPickerSuppressed] = useState(false);
	const shouldShowCommandPicker =
		!commandPickerDisabled &&
		!commandPickerSuppressed &&
		availableCommands.length > 0 &&
		hasSlashPrefix;

	const effectiveCommandHighlight =
		commandHighlight >= commandMatches.length ? 0 : commandHighlight;

	const handleCommandClick = (command: AvailableCommand) => {
		const nextValue = `/${command.name}`;
		if (activeSessionId) {
			setInput(activeSessionId, nextValue);
		}
		setCommandHighlight(0);
		setCommandPickerSuppressed(true);
	};

	useEffect(() => {
		if (!hasSlashPrefix) {
			setCommandPickerSuppressed(false);
			setCommandHighlight(0);
			return;
		}
		if (rawInput === "/") {
			setCommandPickerSuppressed(false);
			setCommandHighlight(0);
		}
	}, [hasSlashPrefix, rawInput]);

	const handleCommandNavigate = (direction: "next" | "prev") => {
		setCommandHighlight((previous) => {
			if (commandMatches.length === 0) {
				return 0;
			}
			const nextIndex = direction === "next" ? previous + 1 : previous - 1;
			if (nextIndex < 0) {
				return commandMatches.length - 1;
			}
			if (nextIndex >= commandMatches.length) {
				return 0;
			}
			return nextIndex;
		});
	};

	const handleCommandSelect = () => {
		if (commandMatches.length === 0) {
			return false;
		}
		const target = commandMatches[effectiveCommandHighlight];
		if (!target) {
			return false;
		}
		handleCommandClick(target);
		return true;
	};

	const showModelModeControls = Boolean(
		availableModels.length > 0 ||
			modelLabel ||
			availableModes.length > 0 ||
			modeLabel,
	);
	const showFooterMeta = Boolean(
		activeSession && (showModelModeControls || activeSession.sending),
	);

	return (
		<footer className="bg-background/90 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shrink-0">
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
				<div className="relative flex w-full items-end gap-2">
					{shouldShowCommandPicker ? (
						<CommandCombobox
							commands={commandMatches}
							open={shouldShowCommandPicker}
							highlightedIndex={effectiveCommandHighlight}
							onHighlightChange={setCommandHighlight}
							onSelect={handleCommandClick}
							className="absolute bottom-full left-0 mb-2"
						/>
					) : null}
					{showModelModeControls ? (
						<div className="flex flex-col gap-2 md:hidden">
							{availableModels.length > 0 ? (
								<Select
									value={activeSession?.modelId ?? ""}
									onValueChange={onModelChange}
									disabled={!activeSessionId || !isReady || isModelSwitching}
								>
									<SelectTrigger
										size="sm"
										className="h-7 w-12 justify-center px-1"
									>
										<HugeiconsIcon
											icon={ComputerIcon}
											strokeWidth={2}
											className="size-4"
										/>
										<SelectValue
											placeholder={t("chat.modelLabel")}
											className="sr-only"
										/>
									</SelectTrigger>
									<SelectContent>
										{availableModels.map((model) => (
											<SelectItem key={model.id} value={model.id}>
												{t("chat.modelLabelWithValue", { value: model.name })}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : modelLabel ? (
								<Badge variant="outline" className="flex items-center gap-1">
									<HugeiconsIcon
										icon={ComputerIcon}
										strokeWidth={2}
										className="size-4"
									/>
									<span className="sr-only">
										{t("chat.modelLabelWithValue", { value: modelLabel })}
									</span>
								</Badge>
							) : null}
							{availableModes.length > 0 ? (
								<Select
									value={activeSession?.modeId ?? ""}
									onValueChange={onModeChange}
									disabled={!activeSessionId || !isReady || isModeSwitching}
								>
									<SelectTrigger
										size="sm"
										className="h-7 w-12 justify-center px-1"
									>
										<HugeiconsIcon
											icon={SettingsIcon}
											strokeWidth={2}
											className="size-4"
										/>
										<SelectValue
											placeholder={t("chat.modeLabel")}
											className="sr-only"
										/>
									</SelectTrigger>
									<SelectContent>
										{availableModes.map((mode) => (
											<SelectItem key={mode.id} value={mode.id}>
												{t("chat.modeLabelWithValue", { value: mode.name })}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : modeLabel ? (
								<Badge variant="outline" className="flex items-center gap-1">
									<HugeiconsIcon
										icon={SettingsIcon}
										strokeWidth={2}
										className="size-4"
									/>
									<span className="sr-only">
										{t("chat.modeLabelWithValue", { value: modeLabel })}
									</span>
								</Badge>
							) : null}
						</div>
					) : null}
					<Textarea
						className="flex-1 h-10 md:h-auto"
						value={activeSession?.input ?? ""}
						onChange={(event) => {
							if (!activeSessionId) {
								return;
							}
							setInput(activeSessionId, event.target.value);
						}}
						onKeyDown={(event) => {
							if (shouldShowCommandPicker) {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									handleCommandNavigate("next");
									return;
								}
								if (event.key === "ArrowUp") {
									event.preventDefault();
									handleCommandNavigate("prev");
									return;
								}
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									handleCommandSelect();
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									if (activeSessionId) {
										setInput(activeSessionId, "");
									}
									setCommandPickerSuppressed(false);
									return;
								}
							}
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								onSend();
							}
						}}
						placeholder={t("chat.placeholder")}
						rows={MESSAGE_INPUT_ROWS}
						disabled={!activeSessionId}
					/>
					<div className="flex flex-col gap-2 md:flex-row md:items-center">
						{activeSession?.sending ? (
							<Button
								size="sm"
								variant="outline"
								onClick={onCancel}
								disabled={
									!activeSessionId || activeSession.canceling || !isReady
								}
							>
								{activeSession.canceling ? t("chat.stopping") : t("chat.stop")}
							</Button>
						) : null}
						<Button
							size="sm"
							onClick={onSend}
							disabled={
								!activeSessionId ||
								!activeSession?.input.trim() ||
								activeSession.sending ||
								!isReady
							}
						>
							{t("chat.send")}
						</Button>
					</div>
				</div>
				{showFooterMeta ? (
					<div className="hidden flex-wrap items-center justify-between gap-2 text-xs md:flex">
						<div className="flex flex-wrap items-center gap-2">
							{availableModels.length > 0 ? (
								<Select
									value={activeSession?.modelId ?? ""}
									onValueChange={onModelChange}
									disabled={!activeSessionId || !isReady || isModelSwitching}
								>
									<SelectTrigger
										size="sm"
										className="h-7 w-12 justify-center px-1 md:w-auto md:justify-between md:px-2"
									>
										<HugeiconsIcon
											icon={ComputerIcon}
											strokeWidth={2}
											className="size-4"
										/>
										<SelectValue
											placeholder={t("chat.modelLabel")}
											className="sr-only md:not-sr-only"
										/>
									</SelectTrigger>
									<SelectContent>
										{availableModels.map((model) => (
											<SelectItem key={model.id} value={model.id}>
												{t("chat.modelLabelWithValue", { value: model.name })}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : modelLabel ? (
								<Badge variant="outline" className="flex items-center gap-1">
									<HugeiconsIcon
										icon={ComputerIcon}
										strokeWidth={2}
										className="size-4"
									/>
									<span className="sr-only md:not-sr-only">
										{t("chat.modelLabelWithValue", { value: modelLabel })}
									</span>
								</Badge>
							) : null}
							{availableModes.length > 0 ? (
								<Select
									value={activeSession?.modeId ?? ""}
									onValueChange={onModeChange}
									disabled={!activeSessionId || !isReady || isModeSwitching}
								>
									<SelectTrigger
										size="sm"
										className="h-7 w-12 justify-center px-1 md:w-auto md:justify-between md:px-2"
									>
										<HugeiconsIcon
											icon={SettingsIcon}
											strokeWidth={2}
											className="size-4"
										/>
										<SelectValue
											placeholder={t("chat.modeLabel")}
											className="sr-only md:not-sr-only"
										/>
									</SelectTrigger>
									<SelectContent>
										{availableModes.map((mode) => (
											<SelectItem key={mode.id} value={mode.id}>
												{t("chat.modeLabelWithValue", { value: mode.name })}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : modeLabel ? (
								<Badge variant="outline" className="flex items-center gap-1">
									<HugeiconsIcon
										icon={SettingsIcon}
										strokeWidth={2}
										className="size-4"
									/>
									<span className="sr-only md:not-sr-only">
										{t("chat.modeLabelWithValue", { value: modeLabel })}
									</span>
								</Badge>
							) : null}
						</div>
						{activeSession?.sending ? (
							<span className="text-muted-foreground text-xs">
								{t("chat.sending")}
							</span>
						) : null}
					</div>
				) : null}
			</div>
		</footer>
	);
}
