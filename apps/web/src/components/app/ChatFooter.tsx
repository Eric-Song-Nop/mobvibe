import { ComputerIcon, SettingsIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CommandCombobox } from "@/components/app/CommandCombobox";
import { ResourceCombobox } from "@/components/app/ResourceCombobox";
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
import type {
	AvailableCommand,
	ContentBlock,
	ResourceLinkContent,
} from "@/lib/acp";
import { fetchSessionFsResources } from "@/lib/api";
import { type ChatSession, useChatStore } from "@/lib/chat-store";
import { createDefaultContentBlocks } from "@/lib/content-block-utils";
import {
	buildCommandSearchItems,
	filterCommandItems,
} from "@/lib/command-utils";
import {
	buildResourceSearchItems,
	filterResourceItems,
} from "@/lib/resource-utils";
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

type ResourceToken = {
	resource: ResourceLinkContent;
	label: string;
	start: number;
	end: number;
	index: number;
};

const buildResourceTokenLabel = (resource: ResourceLinkContent) =>
	`@${resource.name}`;

const coalesceTextBlocks = (blocks: ContentBlock[]): ContentBlock[] => {
	const merged: ContentBlock[] = [];
	blocks.forEach((block) => {
		if (block.type === "text") {
			const last = merged.at(-1);
			if (last?.type === "text") {
				merged[merged.length - 1] = {
					...last,
					text: `${last.text}${block.text}`,
				};
				return;
			}
			merged.push({ ...block });
			return;
		}
		if (block.type === "resource_link") {
			merged.push(block);
		}
	});
	if (merged.length === 0) {
		return createDefaultContentBlocks("");
	}
	return merged;
};

const syncResourcesWithInput = (
	value: string,
	resources: ResourceLinkContent[],
): ResourceLinkContent[] => {
	let cursor = 0;
	const nextResources: ResourceLinkContent[] = [];
	resources.forEach((resource) => {
		const tokenLabel = buildResourceTokenLabel(resource);
		const tokenIndex = value.indexOf(tokenLabel, cursor);
		if (tokenIndex < 0) {
			return;
		}
		nextResources.push(resource);
		cursor = tokenIndex + tokenLabel.length;
	});
	return nextResources;
};

const buildContentsFromInput = (
	value: string,
	resources: ResourceLinkContent[],
): ContentBlock[] => {
	const alignedResources = syncResourcesWithInput(value, resources);
	if (alignedResources.length === 0) {
		return createDefaultContentBlocks(value);
	}
	let cursor = 0;
	const blocks: ContentBlock[] = [];
	alignedResources.forEach((resource) => {
		const tokenLabel = buildResourceTokenLabel(resource);
		const tokenIndex = value.indexOf(tokenLabel, cursor);
		if (tokenIndex < 0) {
			return;
		}
		blocks.push({ type: "text", text: value.slice(cursor, tokenIndex) });
		blocks.push(resource);
		cursor = tokenIndex + tokenLabel.length;
	});
	blocks.push({ type: "text", text: value.slice(cursor) });
	return coalesceTextBlocks(blocks);
};

const buildResourceTokens = (contents: ContentBlock[]): ResourceToken[] => {
	const tokens: ResourceToken[] = [];
	let offset = 0;
	let resourceIndex = 0;
	contents.forEach((block) => {
		if (block.type === "text") {
			offset += block.text.length;
			return;
		}
		if (block.type === "resource_link") {
			const label = buildResourceTokenLabel(block);
			tokens.push({
				resource: block,
				label,
				start: offset,
				end: offset + label.length,
				index: resourceIndex,
			});
			offset += label.length;
			resourceIndex += 1;
		}
	});
	return tokens;
};

const findResourceTrigger = (
	value: string,
	cursor: number,
	resourceTokens: ResourceToken[],
) => {
	const uptoCursor = value.slice(0, cursor);
	const atIndex = uptoCursor.lastIndexOf("@");
	if (atIndex < 0) {
		return null;
	}
	if (
		resourceTokens.some((token) => atIndex >= token.start && atIndex < token.end)
	) {
		return null;
	}
	const query = uptoCursor.slice(atIndex + 1);
	if (/\s/.test(query)) {
		return null;
	}
	return { start: atIndex, end: cursor, query };
};

const buildFileUri = (filePath: string) => {
	const encoded = filePath.split("/").map(encodeURIComponent).join("/");
	return `file://${encoded}`;
};

type RemovalRange = { start: number; end: number };

const mergeRanges = (ranges: RemovalRange[]): RemovalRange[] => {
	if (ranges.length === 0) {
		return [];
	}
	const sorted = [...ranges].sort((left, right) => left.start - right.start);
	const merged: RemovalRange[] = [sorted[0]!];
	sorted.slice(1).forEach((range) => {
		const last = merged[merged.length - 1];
		if (range.start <= last.end) {
			last.end = Math.max(last.end, range.end);
			return;
		}
		merged.push({ ...range });
	});
	return merged;
};

const removeRanges = (value: string, ranges: RemovalRange[]) => {
	const merged = mergeRanges(ranges);
	let cursor = 0;
	let output = "";
	merged.forEach((range) => {
		output += value.slice(cursor, range.start);
		cursor = range.end;
	});
	output += value.slice(cursor);
	return output;
};

const findTokensInSelection = (
	tokens: ResourceToken[],
	selectionStart: number,
	selectionEnd: number,
) =>
	tokens.filter((token) =>
		selectionStart === selectionEnd
			? selectionStart > token.start && selectionStart < token.end
			: selectionStart < token.end && selectionEnd > token.start,
	);

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
	const { setInput, setInputContents } = useChatStore();
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
	const resourcesQuery = useQuery({
		queryKey: ["session-resources", activeSessionId],
		queryFn: () => {
			if (!activeSessionId) {
				return Promise.resolve({ rootPath: "", entries: [] });
			}
			return fetchSessionFsResources({ sessionId: activeSessionId });
		},
		enabled: Boolean(activeSessionId),
	});
	const resourceEntries = resourcesQuery.data?.entries ?? [];
	const resourceSearchItems = useMemo(
		() => buildResourceSearchItems(resourceEntries),
		[resourceEntries],
	);
	const resourceTokens = useMemo(
		() => buildResourceTokens(activeSession?.inputContents ?? []),
		[activeSession?.inputContents],
	);
	const [resourceHighlight, setResourceHighlight] = useState(0);
	const [resourcePickerSuppressed, setResourcePickerSuppressed] = useState(false);
	const [inputCursor, setInputCursor] = useState(rawInput.length);
	const resourceTrigger = useMemo(
		() =>
			resourcePickerSuppressed
				? null
				: findResourceTrigger(rawInput, inputCursor, resourceTokens),
		[rawInput, inputCursor, resourceTokens, resourcePickerSuppressed],
	);
	const previousResourceTrigger = useRef<number | null>(
		resourceTrigger?.start ?? null,
	);
	const resourceMatches = useMemo(
		() =>
			resourceTrigger
				? filterResourceItems(resourceSearchItems, resourceTrigger.query)
				: [],
		[resourceSearchItems, resourceTrigger],
	);

	const resourcePickerDisabled = !activeSessionId || !isReady;
	const shouldShowResourcePicker =
		!resourcePickerDisabled &&
		!resourcePickerSuppressed &&
		resourceTrigger !== null;

	const effectiveCommandHighlight =
		commandHighlight >= commandMatches.length ? 0 : commandHighlight;
	const effectiveResourceHighlight =
		resourceHighlight >= resourceMatches.length ? 0 : resourceHighlight;

	const handleCommandClick = (command: AvailableCommand) => {
		const nextValue = `/${command.name}`;
		if (activeSessionId) {
		setInput(activeSessionId, nextValue);
		setInputContents(activeSessionId, createDefaultContentBlocks(nextValue));
		setInputCursor(nextValue.length);

		}
		setCommandHighlight(0);
		setCommandPickerSuppressed(true);
	};

	const handleResourceNavigate = (direction: "next" | "prev") => {
		setResourceHighlight((previous) => {
			if (resourceMatches.length === 0) {
				return 0;
			}
			const nextIndex = direction === "next" ? previous + 1 : previous - 1;
			if (nextIndex < 0) {
				return resourceMatches.length - 1;
			}
			if (nextIndex >= resourceMatches.length) {
				return 0;
			}
			return nextIndex;
		});
	};

	const handleResourceSelect = () => {
		const target = resourceMatches[effectiveResourceHighlight];
		if (!target || !activeSessionId) {
			return false;
		}
		if (!resourceTrigger) {
			return false;
		}
		const filename = target.name;
		const tokenLabel = `@${filename}`;
		const nextInput =
			rawInput.slice(0, resourceTrigger.start) +
			tokenLabel +
			rawInput.slice(resourceTrigger.end);
		setInputCursor(resourceTrigger.start + tokenLabel.length);
		const nextResource: ResourceLinkContent = {
			type: "resource_link",
			uri: buildFileUri(target.path),
			name: filename,
		};
		const nextResources = [...resourceTokens.map((token) => token.resource)];
		nextResources.push(nextResource);
		const nextContents = buildContentsFromInput(nextInput, nextResources);
		setInput(activeSessionId, nextInput);
		setInputContents(activeSessionId, nextContents);
		setResourceHighlight(0);
		setResourcePickerSuppressed(true);
		return true;
	};

	useEffect(() => {
		const currentStart = resourceTrigger?.start ?? null;
		if (previousResourceTrigger.current !== currentStart) {
			setResourceHighlight(0);
			previousResourceTrigger.current = currentStart;
		}
		if (!resourceTrigger) {
			setResourcePickerSuppressed(false);
		}
	}, [resourceTrigger]);

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
					{shouldShowResourcePicker ? (
						<ResourceCombobox
							resources={resourceMatches}
							open={shouldShowResourcePicker}
							highlightedIndex={effectiveResourceHighlight}
							onHighlightChange={setResourceHighlight}
							onSelect={handleResourceSelect}
							className="absolute bottom-full left-0 mb-2"
						/>
					) : null}
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
							const target = event.target;
							const nextValue = target.value;
							const selectionStart = target.selectionStart ?? nextValue.length;
							const selectionEnd = target.selectionEnd ?? nextValue.length;
							setInputCursor(selectionStart);
							const touchedTokens = findTokensInSelection(
								resourceTokens,
								selectionStart,
								selectionEnd,
							);
							const sanitizedValue =
								touchedTokens.length > 0
									? removeRanges(
										nextValue,
										touchedTokens.map((token) => ({
											start: token.start,
											end: token.end,
										})),
									)
									: nextValue;
							const remainingResources =
								touchedTokens.length > 0
									? resourceTokens
										.filter((token) => !touchedTokens.includes(token))
										.map((token) => token.resource)
									: resourceTokens.map((token) => token.resource);
							const nextContents = buildContentsFromInput(
								sanitizedValue,
								remainingResources,
							);
							setInput(activeSessionId, sanitizedValue);
							setInputContents(activeSessionId, nextContents);
						}}
						onKeyDown={(event) => {
							if (shouldShowResourcePicker) {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									handleResourceNavigate("next");
									return;
								}
								if (event.key === "ArrowUp") {
									event.preventDefault();
									handleResourceNavigate("prev");
									return;
								}
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									handleResourceSelect();
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									setResourcePickerSuppressed(true);
									return;
								}
							}
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
										setInputContents(
											activeSessionId,
											createDefaultContentBlocks(""),
										);
										setInputCursor(0);
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
