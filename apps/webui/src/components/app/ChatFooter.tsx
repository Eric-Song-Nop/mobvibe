import { ArrowUp01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import type { AvailableCommand, ContentBlock, ResourceLink } from "@/lib/acp";
import {
	fetchSessionFsResources,
	type SessionFsResourceEntry,
} from "@/lib/api";
import { type ChatSession, useChatStore } from "@/lib/chat-store";
import { filterCommandItems } from "@/lib/command-utils";
import { createDefaultContentBlocks } from "@/lib/content-block-utils";
import type { FuzzySearchResult } from "@/lib/fuzzy-search";
import { filterResourceItems } from "@/lib/resource-utils";
import { useUiStore } from "@/lib/ui-store";
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
	const { setInput, setInputContents } = useChatStore();
	const { t } = useTranslation();
	const availableModels = activeSession?.availableModels ?? [];
	const availableModes = activeSession?.availableModes ?? [];
	const availableCommands = activeSession?.availableCommands ?? [];
	const modelLabel = activeSession?.modelName ?? activeSession?.modelId;
	const modeLabel = activeSession?.modeName ?? activeSession?.modeId;
	const isReady = Boolean(
		activeSession?.isAttached && !activeSession?.isLoading,
	);
	const contentBlocks =
		activeSession?.inputContents ?? createDefaultContentBlocks("");
	const rawInput = useMemo(
		() => buildInputValueFromContents(contentBlocks),
		[contentBlocks],
	);
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
			if (!activeSessionId) {
				return Promise.resolve({ rootPath: "", entries: [] });
			}
			return fetchSessionFsResources({ sessionId: activeSessionId });
		},
		enabled: Boolean(activeSessionId),
	});
	const resourceEntries = resourcesQuery.data?.entries ?? [];
	const resourceTokens = useMemo(
		() => buildResourceTokens(contentBlocks),
		[contentBlocks],
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

	const handleCommandClick = useCallback(
		(result: FuzzySearchResult<AvailableCommand>) => {
			const nextValue = `/${result.item.name}`;
			if (activeSessionId) {
				setInput(activeSessionId, nextValue);
				setInputContents(
					activeSessionId,
					createDefaultContentBlocks(nextValue),
				);
				setInputCursor(nextValue.length);
			}
			setCommandHighlight(0);
			setCommandPickerSuppressed(true);
		},
		[activeSessionId, setInput, setInputContents],
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
			setInput(activeSessionId, buildInputValueFromContents(nextContents));
			setInputContents(activeSessionId, nextContents);
			setInputCursor(nextCursor);
		},
		[activeSessionId, setInput, setInputContents],
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
	const fileExplorerAvailable = Boolean(activeSession?.cwd && activeSessionId);
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
						setInput(activeSessionId, "");
						setInputContents(activeSessionId, createDefaultContentBlocks(""));
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
			handleCommandNavigate,
			handleCommandSelect,
			handleResourceNavigate,
			handleResourceSelect,
			onSend,
			setInput,
			setInputContents,
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
		[activeSessionId, renderEditorContents, updateFromEditor],
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
			renderEditorContents(editor, contentBlocks);
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
	}, [contentBlocks, renderEditorContents]);

	return (
		<footer className="bg-background/90 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shrink-0">
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

					{/* Text input */}
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
						tabIndex={0}
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
								disabled={!activeSessionId || !isReady || isModelSwitching}
							>
								<SelectTrigger
									size="sm"
									className="h-auto w-auto max-w-32 truncate border-0 bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus:ring-0"
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
								disabled={!activeSessionId || !isReady || isModeSwitching}
							>
								<SelectTrigger
									size="sm"
									className="h-auto w-auto max-w-32 truncate border-0 bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus:ring-0"
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
								!activeSessionId ||
								!isReady ||
								activeSession?.canceling ||
								(!activeSession?.sending && !activeSession?.input.trim())
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
}
