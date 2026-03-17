import { ArrowUp01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	PROMPT_IMAGE_MIME_TYPES,
	resolvePromptImageMimeTypeFromPath,
	validatePromptImageBlocks,
} from "@mobvibe/shared";
import { useQuery } from "@tanstack/react-query";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { CommandCombobox } from "@/components/app/CommandCombobox";
import { ResourceCombobox } from "@/components/app/ResourceCombobox";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AvailableCommand, ContentBlock, ResourceLink } from "@/lib/acp";
import {
	fetchSessionFsFile,
	fetchSessionFsResources,
	type SessionFsResourceEntry,
} from "@/lib/api";
import type { ChatSession } from "@/lib/chat-store";
import { filterCommandItems } from "@/lib/command-utils";
import { createDefaultContentBlocks } from "@/lib/content-block-utils";
import type { FuzzySearchResult } from "@/lib/fuzzy-search";
import { useMachinesStore } from "@/lib/machines-store";
import {
	normalizeImageFileForPrompt,
	parseWorkspaceImageForPrompt,
} from "@/lib/prompt-images";
import { filterResourceItems } from "@/lib/resource-utils";
import { createEmptyChatDraft, useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

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
	resource: ResourceLink;
	label: string;
	start: number;
	end: number;
	index: number;
};

const buildResourceTokenLabel = (resource: ResourceLink) => `@${resource.name}`;

const isEditorContentBlock = (
	block: ContentBlock,
): block is Extract<ContentBlock, { type: "text" | "resource_link" }> =>
	block.type === "text" || block.type === "resource_link";

const isImageContentBlock = (
	block: ContentBlock,
): block is Extract<ContentBlock, { type: "image" }> => block.type === "image";

const getEditorContentBlocks = (blocks: ContentBlock[]) =>
	blocks.filter(isEditorContentBlock);

const getImageContentBlocks = (blocks: ContentBlock[]) =>
	blocks.filter(isImageContentBlock);

const mergeComposerContents = (
	editorBlocks: ContentBlock[],
	imageBlocks: Extract<ContentBlock, { type: "image" }>[],
): ContentBlock[] => [...editorBlocks, ...imageBlocks];

const hasSendablePromptContent = (blocks: ContentBlock[]) =>
	blocks.some(
		(block) =>
			block.type === "image" ||
			block.type === "resource_link" ||
			(block.type === "text" && block.text.trim().length > 0),
	);

const isPromptImageFile = (file: File | null): file is File =>
	file !== null &&
	PROMPT_IMAGE_MIME_TYPES.includes(
		file.type as (typeof PROMPT_IMAGE_MIME_TYPES)[number],
	);

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
	resources: ResourceLink[],
): ResourceLink[] => {
	let cursor = 0;
	const nextResources: ResourceLink[] = [];
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
	resources: ResourceLink[],
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
		blocks.push({ type: "resource_link", ...resource });
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
		resourceTokens.some(
			(token) => atIndex >= token.start && atIndex < token.end,
		)
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

const buildInputValueFromContents = (contents: ContentBlock[]) =>
	contents
		.map((block) => {
			if (block.type === "text") {
				return block.text;
			}
			if (block.type === "resource_link") {
				return buildResourceTokenLabel(block);
			}
			return "";
		})
		.join("");

const parseEditorContents = (root: HTMLElement): ContentBlock[] => {
	const blocks: ContentBlock[] = [];
	const pushText = (text: string) => {
		if (!text) {
			return;
		}
		const last = blocks.at(-1);
		if (last?.type === "text") {
			last.text = `${last.text}${text}`;
			return;
		}
		blocks.push({ type: "text", text });
	};
	const walkNode = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			pushText(node.textContent ?? "");
			return;
		}
		if (!(node instanceof HTMLElement)) {
			return;
		}
		if (node.dataset.resourceLink === "true") {
			const uri = node.dataset.resourceUri ?? "";
			const name = node.dataset.resourceName ?? "";
			if (uri && name) {
				blocks.push({ type: "resource_link", uri, name });
			}
			return;
		}
		if (node.tagName === "BR") {
			pushText("\n");
			return;
		}
		const isBlock = node.tagName === "DIV" || node.tagName === "P";
		if (isBlock && blocks.length > 0) {
			pushText("\n");
		}
		node.childNodes.forEach(walkNode);
	};
	root.childNodes.forEach(walkNode);
	return coalesceTextBlocks(blocks);
};

const findResourceNode = (node: Node | null): HTMLElement | null => {
	let current = node;
	while (current) {
		if (
			current instanceof HTMLElement &&
			current.dataset.resourceLink === "true"
		) {
			return current;
		}
		current = current.parentNode;
	}
	return null;
};

const collectTokensInRange = (root: HTMLElement, range: Range): HTMLElement[] =>
	Array.from(root.querySelectorAll<HTMLElement>("[data-resource-link='true']"))
		.filter((node) => range.intersectsNode(node))
		.map((node) => node);

const resolveAdjacentToken = (
	root: HTMLElement,
	range: Range,
	direction: "backward" | "forward",
): HTMLElement | null => {
	if (!range.collapsed) {
		return null;
	}
	const { startContainer, startOffset } = range;
	const isBackward = direction === "backward";
	if (startContainer.nodeType === Node.TEXT_NODE) {
		const text = startContainer.textContent ?? "";
		if (isBackward && startOffset === 0) {
			return findResourceNode(startContainer.previousSibling);
		}
		if (!isBackward && startOffset === text.length) {
			return findResourceNode(startContainer.nextSibling);
		}
		return null;
	}
	if (startContainer === root) {
		const index = isBackward ? startOffset - 1 : startOffset;
		return findResourceNode(root.childNodes[index] ?? null);
	}
	const siblings = Array.from(startContainer.childNodes);
	const index = isBackward ? startOffset - 1 : startOffset;
	return findResourceNode(siblings[index] ?? null);
};

const getSelectionOffset = (root: HTMLElement) => {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return 0;
	}
	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer)) {
		return 0;
	}
	const prefixRange = range.cloneRange();
	prefixRange.selectNodeContents(root);
	prefixRange.setEnd(range.startContainer, range.startOffset);
	return prefixRange.toString().length;
};

const setSelectionOffset = (root: HTMLElement, offset: number) => {
	const selection = window.getSelection();
	if (!selection) {
		return;
	}
	const walker = document.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
		{
			acceptNode: (node) => {
				if (node.nodeType === Node.TEXT_NODE) {
					const parent = node.parentNode;
					if (
						parent instanceof HTMLElement &&
						parent.dataset.resourceLink === "true"
					) {
						return NodeFilter.FILTER_SKIP;
					}
					return NodeFilter.FILTER_ACCEPT;
				}
				if (
					node instanceof HTMLElement &&
					node.dataset.resourceLink === "true"
				) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_SKIP;
			},
		},
	);
	let remaining = Math.max(0, offset);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent ?? "";
			if (remaining <= text.length) {
				const range = document.createRange();
				range.setStart(node, remaining);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
				return;
			}
			remaining -= text.length;
			continue;
		}
		if (node instanceof HTMLElement && node.dataset.resourceLink === "true") {
			const label = node.dataset.resourceLabel ?? node.textContent ?? "";
			const length = label.length;
			const parent = node.parentNode;
			if (!parent) {
				remaining -= length;
				continue;
			}
			if (remaining <= length) {
				const index = Array.from(parent.childNodes).indexOf(node);
				const position = remaining >= length ? index + 1 : index;
				const range = document.createRange();
				range.setStart(parent, Math.max(0, position));
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
				return;
			}
			remaining -= length;
		}
	}
	const range = document.createRange();
	range.selectNodeContents(root);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
};

const resolveFilePathFromUri = (uri: string) => {
	if (uri.startsWith("file://")) {
		return decodeURIComponent(uri.slice("file://".length));
	}
	if (uri.startsWith("/")) {
		return uri;
	}
	return null;
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
	const { t } = useTranslation();
	const isMobile = useIsMobile();
	const emptyDraft = useRef(createEmptyChatDraft()).current;
	const storedDraft = useUiStore((state) =>
		activeSessionId ? state.chatDrafts[activeSessionId] : undefined,
	);
	const setChatDraft = useUiStore((state) => state.setChatDraft);
	const clearChatDraft = useUiStore((state) => state.clearChatDraft);
	const machines = useMachinesStore((state) => state.machines);
	const availableModels = activeSession?.availableModels ?? [];
	const availableModes = activeSession?.availableModes ?? [];
	const availableCommands = activeSession?.availableCommands ?? [];
	const modelLabel = activeSession?.modelName ?? activeSession?.modelId;
	const modeLabel = activeSession?.modeName ?? activeSession?.modeId;
	const isReady = Boolean(
		activeSession?.isAttached &&
			!activeSession?.isLoading &&
			activeSession?.e2eeStatus !== undefined,
	);
	const canMutateSession = Boolean(
		activeSessionId &&
			!activeSession?.isLoading &&
			(!activeSession?.isAttached || activeSession?.e2eeStatus !== undefined),
	);
	const contentBlocks =
		storedDraft?.inputContents ??
		activeSession?.inputContents ??
		emptyDraft.inputContents;
	const editorContentBlocks = useMemo(
		() => getEditorContentBlocks(contentBlocks),
		[contentBlocks],
	);
	const imageAttachments = useMemo(
		() => getImageContentBlocks(contentBlocks),
		[contentBlocks],
	);
	const draftInput = storedDraft?.input;
	const rawInput = useMemo(
		() => draftInput ?? buildInputValueFromContents(editorContentBlocks),
		[draftInput, editorContentBlocks],
	);
	const imageCapability =
		activeSession?.machineId && activeSession?.backendId
			? machines[activeSession.machineId]?.backendCapabilities?.[
					activeSession.backendId
				]?.prompt?.image
			: undefined;
	const canAttachImages = Boolean(
		activeSessionId && canMutateSession && imageCapability === true,
	);
	const canAttachWorkspaceImages = Boolean(canAttachImages && isReady);
	const hasSlashPrefix = rawInput.startsWith("/");
	const slashInput = hasSlashPrefix ? rawInput.slice(1) : "";
	const commandQuery = hasSlashPrefix
		? (slashInput.trim().split(/\s+/)[0] ?? "")
		: "";
	const commandMatches = useMemo(
		() => filterCommandItems(availableCommands, commandQuery),
		[availableCommands, commandQuery],
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
			if (!activeSessionId || !isReady) {
				return Promise.resolve({ rootPath: "", entries: [] });
			}
			return fetchSessionFsResources({ sessionId: activeSessionId });
		},
		enabled: Boolean(activeSessionId && isReady),
	});
	const resourceEntries = resourcesQuery.data?.entries ?? [];
	const imageResourceEntries = useMemo(
		() =>
			resourceEntries.filter((entry) =>
				Boolean(resolvePromptImageMimeTypeFromPath(entry.path)),
			),
		[resourceEntries],
	);
	const resourceTokens = useMemo(
		() => buildResourceTokens(editorContentBlocks),
		[editorContentBlocks],
	);
	const [resourceHighlight, setResourceHighlight] = useState(0);
	const [resourcePickerSuppressed, setResourcePickerSuppressed] =
		useState(false);
	const [inputCursor, setInputCursor] = useState(rawInput.length);
	const resourceTriggerCandidate = useMemo(
		() => findResourceTrigger(rawInput, inputCursor, resourceTokens),
		[rawInput, inputCursor, resourceTokens],
	);
	const resourceTrigger = resourcePickerSuppressed
		? null
		: resourceTriggerCandidate;
	const previousResourceTrigger = useRef<{
		start: number;
		query: string;
	} | null>(null);
	const resourceMatches = useMemo(
		() =>
			resourceTrigger
				? filterResourceItems(resourceEntries, resourceTrigger.query)
				: [],
		[resourceEntries, resourceTrigger],
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
	const [workspaceImagePickerOpen, setWorkspaceImagePickerOpen] =
		useState(false);
	const [workspaceImageQuery, setWorkspaceImageQuery] = useState("");
	const [workspaceImageHighlight, setWorkspaceImageHighlight] = useState(0);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const [isAttachingImages, setIsAttachingImages] = useState(false);
	const workspaceImageMatches = useMemo(
		() => filterResourceItems(imageResourceEntries, workspaceImageQuery),
		[imageResourceEntries, workspaceImageQuery],
	);
	const effectiveWorkspaceImageHighlight =
		workspaceImageHighlight >= workspaceImageMatches.length
			? 0
			: workspaceImageHighlight;
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const previousSessionId = useRef(activeSessionId);

	const setComposerDraft = useCallback(
		(
			nextEditorBlocks: ContentBlock[],
			nextImageBlocks: Extract<ContentBlock, { type: "image" }>[],
			nextInputValue?: string,
		) => {
			if (!activeSessionId) {
				return;
			}
			setChatDraft(activeSessionId, {
				input: nextInputValue ?? buildInputValueFromContents(nextEditorBlocks),
				inputContents: mergeComposerContents(nextEditorBlocks, nextImageBlocks),
			});
		},
		[activeSessionId, setChatDraft],
	);

	const renderEditorContents = useCallback(
		(
			target: HTMLDivElement,
			blocks: ContentBlock[],
			selectionOverride?: number,
		) => {
			const selectionOffset = selectionOverride ?? getSelectionOffset(target);
			target.innerHTML = "";
			blocks.forEach((block) => {
				if (block.type === "text") {
					if (!block.text) {
						return;
					}
					target.appendChild(document.createTextNode(block.text));
					return;
				}
				if (block.type === "resource_link") {
					const label = buildResourceTokenLabel(block);
					const button = document.createElement("button");
					button.type = "button";
					button.textContent = label;
					button.contentEditable = "false";
					button.dataset.resourceLink = "true";
					button.dataset.resourceUri = block.uri;
					button.dataset.resourceName = block.name;
					button.dataset.resourceLabel = label;
					button.className = cn(
						badgeVariants({ variant: "outline" }),
						"cursor-pointer text-primary hover:text-primary/80",
					);
					target.appendChild(button);
				}
			});
			setSelectionOffset(target, selectionOffset);
		},
		[],
	);

	const syncEditorDOM = useCallback(
		(blocks: ContentBlock[], cursor: number) => {
			const editor = editorRef.current;
			if (editor) {
				renderEditorContents(editor, blocks, cursor);
			}
		},
		[renderEditorContents],
	);

	const handleCommandClick = useCallback(
		(result: FuzzySearchResult<AvailableCommand>) => {
			const nextValue = `/${result.item.name}`;
			if (activeSessionId) {
				const nextBlocks = createDefaultContentBlocks(nextValue);
				setComposerDraft(nextBlocks, imageAttachments, nextValue);
				setInputCursor(nextValue.length);
				// 程序化变更——浏览器 DOM 不会自动反映，需显式重建
				syncEditorDOM(nextBlocks, nextValue.length);
			}
			setCommandHighlight(0);
			setCommandPickerSuppressed(true);
		},
		[activeSessionId, imageAttachments, setComposerDraft, syncEditorDOM],
	);

	const handleResourceNavigate = useCallback(
		(direction: "next" | "prev") => {
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
		},
		[resourceMatches.length],
	);

	const updateFromEditor = useCallback(
		(nextContents: ContentBlock[], nextCursor: number) => {
			if (!activeSessionId) {
				return;
			}
			setComposerDraft(nextContents, imageAttachments);
			setInputCursor(nextCursor);
		},
		[activeSessionId, imageAttachments, setComposerDraft],
	);

	const applyResourceSelection = useCallback(
		(result: FuzzySearchResult<SessionFsResourceEntry>) => {
			if (!activeSessionId) {
				return false;
			}
			if (!resourceTrigger) {
				return false;
			}
			const resource = result.item;
			const filename = resource.name;
			const tokenLabel = `@${filename}`;
			const nextInput =
				rawInput.slice(0, resourceTrigger.start) +
				tokenLabel +
				rawInput.slice(resourceTrigger.end);
			const nextResource: ContentBlock = {
				type: "resource_link",
				uri: buildFileUri(resource.path),
				name: filename,
			};
			const nextResources = [...resourceTokens.map((token) => token.resource)];
			nextResources.push(nextResource);
			const nextContents = buildContentsFromInput(nextInput, nextResources);
			const nextCursor = resourceTrigger.start + tokenLabel.length;
			updateFromEditor(nextContents, nextCursor);
			// 程序化变更——浏览器 DOM 不会自动反映，需显式重建
			syncEditorDOM(nextContents, nextCursor);
			setResourceHighlight(0);
			setResourcePickerSuppressed(true);
			return true;
		},
		[
			activeSessionId,
			rawInput,
			resourceTrigger,
			resourceTokens,
			updateFromEditor,
			syncEditorDOM,
		],
	);

	const handleResourceSelect = useCallback(() => {
		const target = resourceMatches[effectiveResourceHighlight];
		if (!target) {
			return false;
		}
		return applyResourceSelection(target);
	}, [applyResourceSelection, effectiveResourceHighlight, resourceMatches]);

	const handleResourceClick = useCallback(
		(result: FuzzySearchResult<SessionFsResourceEntry>) => {
			applyResourceSelection(result);
		},
		[applyResourceSelection],
	);

	const updateImageAttachments = useCallback(
		(nextImages: Extract<ContentBlock, { type: "image" }>[]) => {
			setComposerDraft(editorContentBlocks, nextImages, rawInput);
		},
		[editorContentBlocks, rawInput, setComposerDraft],
	);

	const appendImageAttachments = useCallback(
		async (nextImages: Extract<ContentBlock, { type: "image" }>[]) => {
			const mergedImages = [...imageAttachments, ...nextImages];
			const validation = validatePromptImageBlocks(mergedImages);
			if (!validation.ok) {
				throw new Error(validation.message);
			}
			updateImageAttachments(mergedImages);
			setAttachmentError(null);
		},
		[imageAttachments, updateImageAttachments],
	);

	const handleLocalImageFiles = useCallback(
		async (files: File[]) => {
			if (!canAttachImages || files.length === 0) {
				return;
			}
			setIsAttachingImages(true);
			try {
				const normalizedImages = await Promise.all(
					files.map((file) => normalizeImageFileForPrompt(file)),
				);
				await appendImageAttachments(normalizedImages);
			} catch (error) {
				setAttachmentError(
					error instanceof Error ? error.message : "Failed to attach image",
				);
			} finally {
				setIsAttachingImages(false);
			}
		},
		[appendImageAttachments, canAttachImages],
	);

	const handleWorkspaceImageClick = useCallback(
		async (result: FuzzySearchResult<SessionFsResourceEntry>) => {
			if (!activeSessionId || !canAttachWorkspaceImages) {
				return;
			}
			setIsAttachingImages(true);
			try {
				const preview = await fetchSessionFsFile({
					sessionId: activeSessionId,
					path: result.item.path,
				});
				if (preview.previewType !== "image") {
					throw new Error("Selected workspace file is not an image");
				}
				await appendImageAttachments([
					parseWorkspaceImageForPrompt(
						preview.content,
						preview.path,
						preview.mimeType,
					),
				]);
				setWorkspaceImagePickerOpen(false);
				setWorkspaceImageQuery("");
				setWorkspaceImageHighlight(0);
			} catch (error) {
				setAttachmentError(
					error instanceof Error ? error.message : "Failed to attach image",
				);
			} finally {
				setIsAttachingImages(false);
			}
		},
		[activeSessionId, appendImageAttachments, canAttachWorkspaceImages],
	);

	const handleRemoveImageAttachment = useCallback(
		(index: number) => {
			updateImageAttachments(
				imageAttachments.filter(
					(_, attachmentIndex) => attachmentIndex !== index,
				),
			);
			setAttachmentError(null);
		},
		[imageAttachments, updateImageAttachments],
	);

	useEffect(() => {
		const nextKey = resourceTrigger
			? { start: resourceTrigger.start, query: resourceTrigger.query }
			: null;
		const previousKey = previousResourceTrigger.current;
		const isSameTrigger =
			nextKey &&
			previousKey &&
			nextKey.start === previousKey.start &&
			nextKey.query === previousKey.query;
		if (!isSameTrigger) {
			setResourceHighlight(0);
		}
		previousResourceTrigger.current = nextKey;
		if (!resourceTriggerCandidate) {
			setResourcePickerSuppressed(false);
		}
	}, [resourceTrigger, resourceTriggerCandidate]);

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

	useEffect(() => {
		if (canAttachImages) {
			return;
		}
		setWorkspaceImagePickerOpen(false);
		setWorkspaceImageQuery("");
	}, [canAttachImages]);

	useEffect(() => {
		if (previousSessionId.current === activeSessionId) {
			return;
		}
		previousSessionId.current = activeSessionId;
		setAttachmentError(null);
		setWorkspaceImagePickerOpen(false);
		setWorkspaceImageQuery("");
		setWorkspaceImageHighlight(0);
	}, [activeSessionId]);

	const handleCommandNavigate = useCallback(
		(direction: "next" | "prev") => {
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
		},
		[commandMatches.length],
	);

	const handleCommandSelect = useCallback(() => {
		if (commandMatches.length === 0) {
			return false;
		}
		const target = commandMatches[effectiveCommandHighlight];
		if (!target) {
			return false;
		}
		handleCommandClick(target);
		return true;
	}, [commandMatches, effectiveCommandHighlight, handleCommandClick]);

	const editorRef = useRef<HTMLDivElement | null>(null);
	const isComposingRef = useRef(false);
	const fileExplorerAvailable = Boolean(
		activeSession?.cwd && activeSessionId && isReady,
	);
	const setFileExplorerOpen = useUiStore((state) => state.setFileExplorerOpen);
	const setFilePreviewPath = useUiStore((state) => state.setFilePreviewPath);
	const handleOpenResourcePreview = useCallback(
		(resource: ResourceLink) => {
			if (!fileExplorerAvailable) {
				return;
			}
			const filePath = resolveFilePathFromUri(resource.uri);
			if (!filePath) {
				return;
			}
			setFilePreviewPath(filePath);
			setFileExplorerOpen(true);
		},
		[fileExplorerAvailable, setFileExplorerOpen, setFilePreviewPath],
	);

	const handleEditorInput = useCallback(() => {
		const editor = editorRef.current;
		if (!editor || !activeSessionId) {
			return;
		}
		if (isComposingRef.current) {
			return;
		}
		setResourcePickerSuppressed(false);
		const selectionOffset = getSelectionOffset(editor);
		const nextContents = parseEditorContents(editor);
		updateFromEditor(nextContents, selectionOffset);
		// Skip renderEditorContents here — the browser DOM is already correct after
		// native input. The useLayoutEffect will handle non-input re-renders
		// (e.g. session switch, external state change).
	}, [activeSessionId, updateFromEditor]);

	const handleEditorBeforeInput = useCallback(
		(event: FormEvent<HTMLDivElement>) => {
			const editor = editorRef.current;
			if (!editor || !activeSessionId) {
				return;
			}
			const inputEvent = event.nativeEvent as InputEvent;
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) {
				return;
			}
			const range = selection.getRangeAt(0);
			const isDeleteAction =
				inputEvent.inputType === "deleteContentBackward" ||
				inputEvent.inputType === "deleteContentForward" ||
				inputEvent.inputType === "deleteByCut" ||
				inputEvent.inputType === "deleteByDrag" ||
				inputEvent.inputType === "deleteContent";
			const isInsertAction = inputEvent.inputType === "insertText";
			const hasSelection = !range.collapsed;
			const hitTokens = hasSelection ? collectTokensInRange(editor, range) : [];
			const deleteAdjacent = isDeleteAction
				? resolveAdjacentToken(
						editor,
						range,
						inputEvent.inputType === "deleteContentBackward"
							? "backward"
							: "forward",
					)
				: null;
			if (isDeleteAction && hitTokens.length > 0) {
				inputEvent.preventDefault();
				hitTokens.forEach((node) => node.remove());
				if (hasSelection) {
					selection.deleteFromDocument();
				}
				const nextContents = parseEditorContents(editor);
				const selectionOffset = getSelectionOffset(editor);
				updateFromEditor(nextContents, selectionOffset);
				renderEditorContents(editor, nextContents, selectionOffset);
				return;
			}
			if (isDeleteAction && deleteAdjacent) {
				inputEvent.preventDefault();
				deleteAdjacent.remove();
				const nextContents = parseEditorContents(editor);
				const selectionOffset = getSelectionOffset(editor);
				updateFromEditor(nextContents, selectionOffset);
				renderEditorContents(editor, nextContents, selectionOffset);
				return;
			}
			const tokenNode = findResourceNode(range.startContainer);
			if (isDeleteAction && tokenNode) {
				inputEvent.preventDefault();
				tokenNode.remove();
				const nextContents = parseEditorContents(editor);
				const selectionOffset = getSelectionOffset(editor);
				updateFromEditor(nextContents, selectionOffset);
				renderEditorContents(editor, nextContents, selectionOffset);
				return;
			}
			if (isInsertAction && hasSelection && hitTokens.length > 0) {
				inputEvent.preventDefault();
				hitTokens.forEach((node) => node.remove());
				selection.deleteFromDocument();
				selection
					.getRangeAt(0)
					.insertNode(document.createTextNode(inputEvent.data ?? ""));
				const nextContents = parseEditorContents(editor);
				const selectionOffset = getSelectionOffset(editor);
				updateFromEditor(nextContents, selectionOffset);
				renderEditorContents(editor, nextContents, selectionOffset);
			}
		},
		[activeSessionId, renderEditorContents, updateFromEditor],
	);

	const handleEditorKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
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
						clearChatDraft(activeSessionId);
						setInputCursor(0);
					}
					setCommandPickerSuppressed(false);
					return;
				}
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				onSend();
				// 主动清空 DOM —— useLayoutEffect 在编辑器聚焦时会跳过重建
				if (editorRef.current) {
					editorRef.current.innerHTML = "";
				}
			}
		},
		[
			activeSessionId,
			clearChatDraft,
			handleCommandNavigate,
			handleCommandSelect,
			handleResourceNavigate,
			handleResourceSelect,
			onSend,
			shouldShowCommandPicker,
			shouldShowResourcePicker,
		],
	);

	const updateCursorFromSelection = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) {
			return;
		}
		setInputCursor(getSelectionOffset(editor));
	}, []);

	const handleEditorClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const resourceBtn = (event.target as HTMLElement).closest<HTMLElement>(
				"[data-resource-link]",
			);
			if (resourceBtn) {
				event.preventDefault();
				const uri = resourceBtn.dataset.resourceUri;
				const name = resourceBtn.dataset.resourceName;
				if (uri && name) {
					handleOpenResourcePreview({ uri, name });
				}
				return;
			}
			updateCursorFromSelection();
		},
		[handleOpenResourcePreview, updateCursorFromSelection],
	);

	const handleEditorPaste = useCallback(
		(event: ClipboardEvent<HTMLDivElement>) => {
			const editor = editorRef.current;
			if (!editor || !activeSessionId) {
				return;
			}
			const clipboardImageFiles =
				canAttachImages && event.clipboardData
					? Array.from(event.clipboardData.items)
							.filter((item) => item.kind === "file")
							.map((item) => item.getAsFile())
							.filter(isPromptImageFile)
					: [];
			if (clipboardImageFiles.length > 0) {
				event.preventDefault();
				void handleLocalImageFiles(clipboardImageFiles);
				return;
			}
			event.preventDefault();
			const text = event.clipboardData.getData("text/plain");
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) {
				return;
			}
			selection.deleteFromDocument();
			selection.getRangeAt(0).insertNode(document.createTextNode(text));
			const nextContents = parseEditorContents(editor);
			const selectionOffset = getSelectionOffset(editor);
			updateFromEditor(nextContents, selectionOffset);
			renderEditorContents(editor, nextContents, selectionOffset);
		},
		[
			activeSessionId,
			canAttachImages,
			handleLocalImageFiles,
			renderEditorContents,
			updateFromEditor,
		],
	);

	const handleUploadButtonClick = useCallback(() => {
		if (!canAttachImages || isAttachingImages) {
			return;
		}
		fileInputRef.current?.click();
	}, [canAttachImages, isAttachingImages]);

	const handleImageInputChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const files = event.target.files ? Array.from(event.target.files) : [];
			event.target.value = "";
			void handleLocalImageFiles(files);
		},
		[handleLocalImageFiles],
	);

	const handleCompositionStart = useCallback(() => {
		isComposingRef.current = true;
	}, []);

	const handleCompositionEnd = useCallback(() => {
		isComposingRef.current = false;
		handleEditorInput();
	}, [handleEditorInput]);

	useLayoutEffect(() => {
		const editor = editorRef.current;
		if (!editor) {
			return;
		}
		if (document.activeElement !== editor) {
			// Editor is not focused — external state change (e.g. session switch),
			// must rebuild DOM.
			renderEditorContents(editor, editorContentBlocks);
			return;
		}
		if (isComposingRef.current) {
			// IME composing — never touch the DOM.
			return;
		}
		// Editor is focused and user is typing — the browser DOM is already
		// correct from native input events, so skip the expensive rebuild.
		// handleEditorBeforeInput / handleEditorPaste will call
		// renderEditorContents explicitly when they need to (e.g. token
		// deletion, paste with resource links).
	}, [editorContentBlocks, renderEditorContents]);

	// Mobile virtual keyboard: track keyboard height via visualViewport
	const footerRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!isMobile) {
			return;
		}
		const vv = window.visualViewport;
		if (!vv) {
			return;
		}
		const update = () => {
			const kbHeight = window.innerHeight - vv.height;
			const footer = footerRef.current;
			if (footer) {
				footer.style.setProperty("--kb-height", `${Math.max(0, kbHeight)}px`);
			}
		};
		update();
		vv.addEventListener("resize", update);
		return () => vv.removeEventListener("resize", update);
	}, [isMobile]);

	const canSend = hasSendablePromptContent(contentBlocks);

	const footerContent = (
		<footer
			ref={footerRef}
			style={isMobile ? { bottom: "var(--kb-height, 0px)" } : undefined}
			className={cn(
				"bg-background/90 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shrink-0",
				isMobile && "fixed inset-x-0 bottom-0 z-40",
			)}
		>
			<div className="mx-auto w-full max-w-5xl">
				<div
					className={cn(
						"relative flex flex-col border border-input",
						"focus-within:ring-1 focus-within:ring-ring/50",
						!activeSessionId ? "opacity-50" : null,
					)}
				>
					{shouldShowResourcePicker ? (
						<ResourceCombobox
							results={resourceMatches}
							open={shouldShowResourcePicker}
							highlightedIndex={effectiveResourceHighlight}
							onHighlightChange={setResourceHighlight}
							onSelect={handleResourceClick}
							className="absolute bottom-full left-0 mb-2"
						/>
					) : null}
					{shouldShowCommandPicker ? (
						<CommandCombobox
							results={commandMatches}
							open={shouldShowCommandPicker}
							highlightedIndex={effectiveCommandHighlight}
							onHighlightChange={setCommandHighlight}
							onSelect={handleCommandClick}
							className="absolute bottom-full left-0 mb-2"
						/>
					) : null}

					<input
						ref={fileInputRef}
						type="file"
						accept={PROMPT_IMAGE_MIME_TYPES.join(",")}
						multiple
						className="hidden"
						tabIndex={-1}
						onChange={handleImageInputChange}
					/>

					{imageAttachments.length > 0 ? (
						<div className="flex flex-wrap gap-2 border-b border-input px-2.5 py-2">
							{imageAttachments.map((image, index) => (
								<div
									key={`${image.uri ?? "upload"}-${index}`}
									className="bg-muted/40 flex items-start gap-2 border border-input p-2"
								>
									<img
										src={`data:${image.mimeType};base64,${image.data}`}
										alt={image.uri ?? `Attached image ${index + 1}`}
										width={48}
										height={48}
										loading="lazy"
										className="size-12 object-cover"
									/>
									<div className="flex min-w-0 flex-col gap-1">
										<span className="max-w-40 truncate text-[11px] text-foreground">
											{image.uri
												? (resolveFilePathFromUri(image.uri) ?? image.uri)
												: `Image ${index + 1}`}
										</span>
										<span className="text-[10px] text-muted-foreground">
											{image.mimeType}
										</span>
										<Button
											type="button"
											variant="ghost"
											size="xs"
											className="h-auto justify-start px-0 text-[10px]"
											onClick={() => handleRemoveImageAttachment(index)}
										>
											Remove
										</Button>
									</div>
								</div>
							))}
						</div>
					) : null}

					<div className="flex flex-wrap items-center gap-2 border-b border-input px-2.5 py-2">
						<Button
							type="button"
							variant="outline"
							size="xs"
							onClick={handleUploadButtonClick}
							disabled={!canAttachImages || isAttachingImages}
						>
							Upload image
						</Button>
						<Button
							type="button"
							variant="outline"
							size="xs"
							onClick={() =>
								setWorkspaceImagePickerOpen((previous) => !previous)
							}
							disabled={!canAttachWorkspaceImages || isAttachingImages}
						>
							From workspace
						</Button>
						{imageCapability !== true ? (
							<span className="text-[11px] text-muted-foreground">
								Image prompts unavailable
							</span>
						) : null}
						{isAttachingImages ? (
							<span className="text-[11px] text-muted-foreground">
								Attaching image...
							</span>
						) : null}
					</div>

					{workspaceImagePickerOpen ? (
						<div className="border-b border-input px-2.5 py-2">
							<input
								type="text"
								value={workspaceImageQuery}
								onChange={(event) => {
									setWorkspaceImageQuery(event.target.value);
									setWorkspaceImageHighlight(0);
								}}
								placeholder="Search workspace images"
								className="mb-2 h-8 w-full border border-input bg-background px-2 text-xs outline-none"
							/>
							<ResourceCombobox
								results={workspaceImageMatches}
								open={workspaceImagePickerOpen}
								highlightedIndex={effectiveWorkspaceImageHighlight}
								onHighlightChange={setWorkspaceImageHighlight}
								onSelect={(result) => {
									void handleWorkspaceImageClick(result);
								}}
							/>
						</div>
					) : null}

					{attachmentError ? (
						<div className="border-b border-input px-2.5 py-2 text-[11px] text-destructive">
							{attachmentError}
						</div>
					) : null}

					{/* Text input */}
					{/* biome-ignore lint/a11y/useSemanticElements: contentEditable composer needs explicit textbox semantics. */}
					<div
						ref={editorRef}
						role="textbox"
						aria-multiline="true"
						contentEditable={Boolean(activeSessionId)}
						enterKeyHint="send"
						suppressContentEditableWarning
						className="min-h-10 max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-2 text-xs outline-none md:min-h-16"
						aria-label={t("chat.placeholder")}
						data-placeholder={t("chat.placeholder")}
						tabIndex={isMobile ? -1 : 0}
						onInput={handleEditorInput}
						onKeyDown={handleEditorKeyDown}
						onClick={handleEditorClick}
						onPaste={handleEditorPaste}
						onBeforeInput={handleEditorBeforeInput}
						onCompositionStart={handleCompositionStart}
						onCompositionEnd={handleCompositionEnd}
					/>

					{/* Bottom toolbar */}
					<div className="flex items-center gap-1 px-2 pb-2">
						{availableModels.length > 0 ? (
							<Select
								value={activeSession?.modelId ?? ""}
								onValueChange={onModelChange}
								disabled={!canMutateSession || isModelSwitching}
							>
								<SelectTrigger
									size="sm"
									className="h-auto w-auto max-w-32 truncate border-0 bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus:ring-0 focus-visible:ring-1 focus-visible:ring-ring/50"
								>
									<SelectValue placeholder={t("chat.modelLabel")} />
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
							<span className="max-w-32 truncate px-1 py-0.5 text-xs text-muted-foreground">
								{modelLabel}
							</span>
						) : null}

						{availableModes.length > 0 ? (
							<Select
								value={activeSession?.modeId ?? ""}
								onValueChange={onModeChange}
								disabled={!canMutateSession || isModeSwitching}
							>
								<SelectTrigger
									size="sm"
									className="h-auto w-auto max-w-32 truncate border-0 bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus:ring-0 focus-visible:ring-1 focus-visible:ring-ring/50"
								>
									<SelectValue placeholder={t("chat.modeLabel")} />
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
							<span className="max-w-32 truncate px-1 py-0.5 text-xs text-muted-foreground">
								{modeLabel}
							</span>
						) : null}

						<div className="flex-1" />

						{/* Combined Send/Stop button */}
						<Button
							size="icon-sm"
							onClick={activeSession?.sending ? onCancel : onSend}
							disabled={
								!canMutateSession ||
								activeSession?.canceling ||
								(activeSession?.sending ? !isReady : !canSend)
							}
						>
							<HugeiconsIcon
								icon={activeSession?.sending ? StopIcon : ArrowUp01Icon}
								strokeWidth={2}
								className="size-4"
								aria-hidden="true"
							/>
							<span className="sr-only">
								{activeSession?.sending
									? activeSession?.canceling
										? t("chat.stopping")
										: t("chat.stop")
									: t("chat.send")}
							</span>
						</Button>
					</div>
				</div>
			</div>
		</footer>
	);

	if (!isMobile) {
		return footerContent;
	}

	// Mobile: spacer keeps flex layout from collapsing + fixed footer floats above keyboard
	return (
		<>
			<div className="shrink-0 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
				<div className="mx-auto w-full max-w-5xl">
					<div className="min-h-10 border border-transparent px-2.5 py-2 text-xs" />
					<div className="flex items-center gap-1 px-2 pb-2">
						<div className="h-5" />
					</div>
				</div>
			</div>
			{footerContent}
		</>
	);
}
