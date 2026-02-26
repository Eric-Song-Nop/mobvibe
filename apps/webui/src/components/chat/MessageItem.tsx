import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	buildUnifiedDiffString,
	UnifiedDiffView,
} from "@/components/chat/DiffView";
import { LazyStreamdown } from "@/components/chat/LazyStreamdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
	AudioContent,
	ContentBlock,
	EmbeddedResource,
	ImageContent,
	PermissionOutcome,
	ResourceLink,
	ToolCallContent,
	ToolCallContentPayload,
	ToolCallStatus,
} from "@/lib/acp";
import { type ChatMessage, useChatStore } from "@/lib/chat-store";
import { cn } from "@/lib/utils";

type PermissionDecisionPayload = {
	requestId: string;
	outcome: PermissionOutcome;
};

type MessageItemProps = {
	message: ChatMessage;
	onPermissionDecision?: (payload: PermissionDecisionPayload) => void;
	onOpenFilePreview?: (path: string) => void;
};

type DiffContent = Extract<ToolCallContent, { type: "diff" }>;

type TerminalOutputBlockProps = {
	terminalId: string;
	output?: string;
	truncated?: boolean;
	exitStatus?: { exitCode?: number | null; signal?: string | null };
	getLabel: (key: string, options?: Record<string, unknown>) => string;
};

const TerminalOutputBlock = ({
	terminalId,
	output,
	truncated,
	exitStatus,
	getLabel,
}: TerminalOutputBlockProps) => (
	<div className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground">
		<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
			{output && output.length > 0 ? output : getLabel("toolCall.noOutput")}
		</pre>
		{exitStatus ? (
			<div className="mt-1 text-[11px] text-muted-foreground">
				{getLabel("toolCall.exitStatus", {
					code: exitStatus.exitCode ?? "-",
				})}
				{exitStatus.signal ? ` (${exitStatus.signal})` : ""}
			</div>
		) : null}
		{truncated ? (
			<div className="mt-1 text-[11px] text-muted-foreground">
				{getLabel("toolCall.outputTruncated")}
			</div>
		) : null}
		{!output ? (
			<div className="mt-1 text-[11px] text-muted-foreground">
				{getLabel("toolCall.terminalWaiting", { terminalId })}
			</div>
		) : null}
	</div>
);

const resolveFileName = (pathValue: string) => {
	const parts = pathValue.split(/[/\\]/).filter(Boolean);
	return parts.at(-1) ?? pathValue;
};

const isAbsolutePath = (pathValue: string) => pathValue.startsWith("/");

const resolveFilePathFromUri = (uri: string) => {
	if (uri.startsWith("file://")) {
		return decodeURIComponent(uri.slice("file://".length));
	}
	if (uri.startsWith("/")) {
		return uri;
	}
	return null;
};

const resolveResourceLabel = (
	uri: string,
	name?: string | null,
	title?: string | null,
) => {
	if (title && title.trim().length > 0) {
		return title;
	}
	if (name && name.trim().length > 0) {
		return name;
	}
	const normalized = uri.startsWith("file://")
		? uri.slice("file://".length)
		: uri;
	return resolveFileName(normalized);
};

const formatBytes = (value: number) => {
	if (!Number.isFinite(value)) {
		return `${value}`;
	}
	if (value < 1024) {
		return `${value} B`;
	}
	const kb = value / 1024;
	if (kb < 1024) {
		return `${kb.toFixed(1)} KB`;
	}
	return `${(kb / 1024).toFixed(1)} MB`;
};

const buildDataUri = (mimeType: string, data: string) =>
	`data:${mimeType};base64,${data}`;

const renderResourceLabel = (
	label: string,
	uri: string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const filePath = resolveFilePathFromUri(uri);
	if (filePath && onOpenFilePreview) {
		return (
			<button
				type="button"
				className="text-xs text-primary hover:underline"
				onClick={(event) => {
					event.preventDefault();
					onOpenFilePreview(filePath);
				}}
			>
				{label}
			</button>
		);
	}
	if (uri.startsWith("http://") || uri.startsWith("https://")) {
		return (
			<a
				href={uri}
				target="_blank"
				rel="noreferrer"
				className="text-xs text-primary hover:underline"
			>
				{label}
			</a>
		);
	}
	return <span className="text-xs text-foreground">{label}</span>;
};

const renderTextContent = (text: string, key: string) => (
	<pre
		key={key}
		className="whitespace-pre-wrap break-words text-xs text-foreground"
	>
		{text}
	</pre>
);

const renderUnknownContent = (payload: ToolCallContentPayload, key: string) => (
	<pre
		key={key}
		className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
	>
		{JSON.stringify(payload, null, 2)}
	</pre>
);

const renderImageContent = (
	content: ImageContent,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const label = resolveResourceLabel(content.uri ?? getLabel("toolCall.image"));
	const source = content.data
		? buildDataUri(content.mimeType, content.data)
		: (content.uri ?? undefined);
	const canPreviewInline =
		source !== undefined &&
		(source.startsWith("data:") ||
			source.startsWith("http://") ||
			source.startsWith("https://"));
	return (
		<div
			key={key}
			className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground"
		>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span>{getLabel("toolCall.image")}</span>
				{content.uri ? (
					renderResourceLabel(label, content.uri, onOpenFilePreview)
				) : (
					<span className="text-xs text-foreground">{label}</span>
				)}
				<span>{content.mimeType}</span>
			</div>
			{canPreviewInline && source ? (
				<img
					src={source}
					alt={label}
					className="mt-2 max-h-48 rounded border border-border"
				/>
			) : (
				<div className="mt-2 text-[11px] text-muted-foreground">
					{getLabel("toolCall.imagePreviewUnavailable")}
				</div>
			)}
		</div>
	);
};

const renderAudioContent = (
	content: AudioContent,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
) => {
	const source = buildDataUri(content.mimeType, content.data);
	return (
		<div
			key={key}
			className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground"
		>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span>{getLabel("toolCall.audio")}</span>
				<span>{content.mimeType}</span>
			</div>
			<audio controls className="mt-2 w-full">
				<source src={source} type={content.mimeType} />
				<track kind="captions" />
			</audio>
		</div>
	);
};

const renderEmbeddedResource = (
	content: EmbeddedResource,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const label = resolveResourceLabel(content.resource.uri);
	// SDK uses union type: TextEmbeddedResources | BlobEmbeddedResources
	const hasText = "text" in content.resource;
	const hasBlob = "blob" in content.resource;
	return (
		<div
			key={key}
			className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground"
		>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span>{getLabel("toolCall.resource")}</span>
				{renderResourceLabel(label, content.resource.uri, onOpenFilePreview)}
				{content.resource.mimeType ? (
					<span>{content.resource.mimeType}</span>
				) : null}
			</div>
			{hasText ? (
				<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
					{(content.resource as { text: string }).text}
				</pre>
			) : hasBlob ? (
				<div className="mt-2 text-[11px] text-muted-foreground">
					{getLabel("toolCall.binaryResource")}
				</div>
			) : (
				<div className="mt-2 text-[11px] text-muted-foreground">
					{getLabel("toolCall.resourceUnavailable")}
				</div>
			)}
		</div>
	);
};

const renderResourceLink = (
	content: ResourceLink,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const label = resolveResourceLabel(content.uri, content.name, content.title);
	// SDK uses bigint | null for size, convert to number for formatBytes
	const size =
		content.size !== undefined && content.size !== null
			? Number(content.size)
			: undefined;
	const meta = [content.mimeType, size !== undefined ? formatBytes(size) : null]
		.filter((item): item is string => Boolean(item))
		.join(" · ");
	return (
		<div
			key={key}
			className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground"
		>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span>{getLabel("toolCall.resourceLink")}</span>
				{renderResourceLabel(label, content.uri, onOpenFilePreview)}
				{meta ? <span>{meta}</span> : null}
			</div>
			{content.description ? (
				<div className="mt-1 text-[11px] text-muted-foreground">
					{content.description}
				</div>
			) : null}
		</div>
	);
};

const extractUserMessageText = (
	message: Extract<ChatMessage, { kind: "text" }>,
): string => {
	const blocks = message.contentBlocks;
	if (blocks.length === 0) return message.content;
	return blocks
		.filter(
			(b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
		)
		.map((b) => b.text)
		.join("\n");
};

const renderUserContent = (
	message: Extract<ChatMessage, { kind: "text" }>,
	onOpenFilePreview?: (path: string) => void,
) => {
	const contentBlocks = message.contentBlocks ?? [];
	if (contentBlocks.length === 0) {
		return <LazyStreamdown>{message.content}</LazyStreamdown>;
	}
	const parts = contentBlocks.map((block, index) => {
		if (block.type === "text") {
			return (
				<LazyStreamdown key={`text-${index}`}>{block.text}</LazyStreamdown>
			);
		}
		if (block.type === "resource_link") {
			const label = `@${block.name}`;
			const filePath = resolveFilePathFromUri(block.uri);
			if (filePath && onOpenFilePreview) {
				return (
					<button
						key={`resource-${index}`}
						type="button"
						className="text-primary hover:underline"
						onClick={(event) => {
							event.preventDefault();
							onOpenFilePreview(filePath);
						}}
					>
						{label}
					</button>
				);
			}
			return (
				<span key={`resource-${index}`} className="text-foreground">
					{label}
				</span>
			);
		}
		return null;
	});
	return <div className="flex flex-wrap gap-1">{parts}</div>;
};

const renderContentBlock = (
	content: ContentBlock,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	switch (content.type) {
		case "text":
			return renderTextContent(content.text, key);
		case "image":
			return renderImageContent(content, key, getLabel, onOpenFilePreview);
		case "audio":
			return renderAudioContent(content, key, getLabel);
		case "resource":
			return renderEmbeddedResource(content, key, getLabel, onOpenFilePreview);
		case "resource_link":
			return renderResourceLink(content, key, getLabel, onOpenFilePreview);
		default:
			return renderUnknownContent(content, key);
	}
};

const isDiffPayload = (
	payload: ToolCallContentPayload,
): payload is DiffContent => {
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const value = payload as {
		type?: unknown;
		path?: unknown;
		newText?: unknown;
	};
	return (
		value.type === "diff" &&
		typeof value.path === "string" &&
		typeof value.newText === "string"
	);
};

const renderToolCallContentPayload = (
	payload: ToolCallContentPayload,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	if (typeof payload === "string") {
		return renderTextContent(payload, key);
	}
	if (isDiffPayload(payload)) {
		return renderDiffBlock(payload, key, getLabel, onOpenFilePreview);
	}
	if (payload && typeof payload === "object" && "type" in payload) {
		return renderContentBlock(
			payload as ContentBlock,
			key,
			getLabel,
			onOpenFilePreview,
		);
	}
	return renderUnknownContent(payload, key);
};

const renderDiffBlock = (
	content: DiffContent,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const diff = buildUnifiedDiffString(
		content.oldText,
		content.newText,
		content.path,
	);
	if (!diff) {
		return null;
	}
	return (
		<UnifiedDiffView
			key={key}
			diff={diff}
			path={content.path}
			getLabel={getLabel}
			onOpenFilePreview={onOpenFilePreview}
		/>
	);
};

const parseRawInputValue = <T,>(
	rawInput: Record<string, unknown> | undefined,
	key: string,
): T | undefined => {
	const value = rawInput?.[key];
	return value as T | undefined;
};

const collectToolCallPaths = (
	message: Extract<ChatMessage, { kind: "tool_call" }>,
) => {
	const paths = new Set<string>();
	message.locations?.forEach((location) => {
		if (location.path) {
			paths.add(location.path);
		}
	});
	message.content?.forEach((item) => {
		if (item.type === "diff" && item.path) {
			paths.add(item.path);
		}
	});
	const rawPath = parseRawInputValue<string>(message.rawInput, "path");
	if (rawPath && isAbsolutePath(rawPath)) {
		paths.add(rawPath);
	}
	const rawFilePath =
		parseRawInputValue<string>(message.rawInput, "file_path") ??
		parseRawInputValue<string>(message.rawInput, "filePath");
	if (rawFilePath && isAbsolutePath(rawFilePath)) {
		paths.add(rawFilePath);
	}
	const rawPaths = parseRawInputValue<unknown[]>(message.rawInput, "paths");
	if (Array.isArray(rawPaths)) {
		rawPaths.forEach((entry) => {
			if (typeof entry === "string" && isAbsolutePath(entry)) {
				paths.add(entry);
			}
		});
	}
	const rawEdits = parseRawInputValue<unknown[]>(message.rawInput, "edits");
	if (Array.isArray(rawEdits)) {
		rawEdits.forEach((entry) => {
			if (!entry || typeof entry !== "object") {
				return;
			}
			const editPath = (entry as { path?: unknown }).path;
			if (typeof editPath === "string" && isAbsolutePath(editPath)) {
				paths.add(editPath);
			}
		});
	}
	const rawPatch =
		parseRawInputValue<string>(message.rawInput, "patch") ??
		parseRawInputValue<string>(message.rawInput, "patchText") ??
		parseRawInputValue<string>(message.rawInput, "diff");
	if (rawPatch) {
		const matches = rawPatch.matchAll(
			/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm,
		);
		Array.from(matches, (match) => match[1]?.trim())
			.filter((pathValue): pathValue is string =>
				Boolean(pathValue && isAbsolutePath(pathValue)),
			)
			.forEach((pathValue) => {
				paths.add(pathValue);
			});
	}
	return Array.from(paths);
};

const resolveStatusLabel = (
	status: string | undefined,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
) => {
	if (!status) {
		return getLabel("toolCall.statusUnknown");
	}
	switch (status) {
		case "pending":
			return getLabel("toolCall.statusPending");
		case "in_progress":
			return getLabel("toolCall.statusInProgress");
		case "completed":
			return getLabel("toolCall.statusCompleted");
		case "failed":
			return getLabel("toolCall.statusFailed");
		default:
			return getLabel("toolCall.statusUnknown");
	}
};

const TOOL_CALL_PATH_SUMMARY_LIMIT = 3;

const getStatusDotColor = (status: ToolCallStatus | undefined) => {
	switch (status) {
		case "completed":
			return "bg-green-600";
		case "failed":
			return "bg-destructive";
		default:
			return "bg-muted-foreground";
	}
};

const extractUnifiedDiff = (
	rawOutput: Record<string, unknown> | undefined,
): string | undefined => {
	if (!rawOutput) return undefined;
	const metadata = rawOutput.metadata as Record<string, unknown> | undefined;
	if (!metadata) return undefined;
	const diff = metadata.diff;
	return typeof diff === "string" ? diff : undefined;
};

// --- Extracted sub-components for reuse in ToolCallGroup ---

type ToolCallItemContentProps = {
	message: Extract<ChatMessage, { kind: "tool_call" }>;
	onOpenFilePreview?: (path: string) => void;
};

export const ToolCallItemContent = ({
	message,
	onOpenFilePreview,
}: ToolCallItemContentProps) => {
	const { t } = useTranslation();
	const getLabel = (key: string, options?: Record<string, unknown>) =>
		t(key, { defaultValue: key, ...options });

	const terminalOutputMap = useChatStore((state) => {
		if (!message.sessionId) return undefined;
		return state.sessions[message.sessionId]?.terminalOutputs;
	});

	const label = message.title ?? message.name ?? getLabel("toolCall.toolCall");
	const statusLabel = resolveStatusLabel(message.status, getLabel);
	const statusBadgeVariant =
		message.status === "failed" ? "destructive" : "secondary";
	const commandLine =
		message.command || message.args?.length
			? `${message.command ?? ""}${message.args?.length ? ` ${message.args.join(" ")}` : ""}`.trim()
			: undefined;
	const detailPaths = collectToolCallPaths(message);
	const displayPaths = detailPaths.map((pathValue) => ({
		path: pathValue,
		name: resolveFileName(pathValue),
	}));
	const summaryPaths = displayPaths.slice(0, TOOL_CALL_PATH_SUMMARY_LIMIT);
	const overflowCount = Math.max(0, displayPaths.length - summaryPaths.length);
	const outputBlocks = message.content?.map((contentBlock, index) => {
		const key = `${message.toolCallId}-content-${index}`;
		if (contentBlock.type === "content") {
			return renderToolCallContentPayload(
				contentBlock.content,
				key,
				getLabel,
				onOpenFilePreview,
			);
		}
		if (contentBlock.type === "diff") {
			return renderDiffBlock(contentBlock, key, getLabel, onOpenFilePreview);
		}
		return null;
	});
	const terminalIds = message.content?.flatMap((contentBlock) =>
		contentBlock.type === "terminal" ? [contentBlock.terminalId] : [],
	);
	const unifiedDiff = extractUnifiedDiff(message.rawOutput);
	const hasOutputs = Boolean(
		outputBlocks?.some(Boolean) ||
			(terminalIds && terminalIds.length > 0) ||
			unifiedDiff ||
			message.rawOutput,
	);
	const isTaskTool = message.name === "Task" || message.name === "task";

	return (
		<div className="flex flex-col gap-0.5 items-start">
			<div className="flex items-start gap-2">
				<span
					className={cn(
						"mt-1 size-2 shrink-0 rounded-full",
						getStatusDotColor(message.status),
					)}
				/>
				<div className="flex flex-col gap-0.5 min-w-0">
					<div className="flex flex-wrap items-center gap-1.5 text-sm">
						<span className="font-medium text-foreground">
							{isTaskTool ? "Task" : label}
						</span>
						{isTaskTool ? (
							<span className="text-muted-foreground italic">{label}</span>
						) : null}
						{message.status === "failed" ? (
							<Badge variant={statusBadgeVariant} className="text-[10px]">
								{statusLabel}
							</Badge>
						) : null}
					</div>
					{summaryPaths.length > 0 ? (
						<div className="flex flex-wrap items-center gap-1 text-xs">
							{summaryPaths.map((item) => (
								<button
									key={item.path}
									type="button"
									className="text-primary hover:underline"
									onClick={(event) => {
										event.preventDefault();
										onOpenFilePreview?.(item.path);
									}}
									disabled={!onOpenFilePreview}
								>
									{item.name}
								</button>
							))}
							{overflowCount > 0 ? (
								<span className="text-muted-foreground">+{overflowCount}</span>
							) : null}
						</div>
					) : null}
					{commandLine || message.error || hasOutputs ? (
						<details className="mt-1 text-xs">
							<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
								{getLabel("toolCall.details")}
							</summary>
							<div className="mt-1 flex flex-col gap-2 pl-2 border-l border-border">
								{commandLine ? (
									<div className="text-muted-foreground">{commandLine}</div>
								) : null}
								{message.error ? (
									<div className="text-destructive">{message.error}</div>
								) : null}
								{hasOutputs ? (
									<div className="flex flex-col gap-2">
										{outputBlocks?.filter(Boolean)}
										{terminalIds?.map((terminalId) => {
											const output = terminalOutputMap?.[terminalId];
											return (
												<TerminalOutputBlock
													key={`${message.toolCallId}-${terminalId}`}
													terminalId={terminalId}
													output={output?.output}
													truncated={output?.truncated}
													exitStatus={output?.exitStatus}
													getLabel={getLabel}
												/>
											);
										})}
										{unifiedDiff ? (
											<UnifiedDiffView
												diff={unifiedDiff}
												path={displayPaths[0]?.path ?? ""}
												getLabel={getLabel}
												onOpenFilePreview={onOpenFilePreview}
											/>
										) : null}
										{message.rawOutput ? (
											<details className="rounded border border-border bg-background/80 px-2 py-1">
												<summary className="cursor-pointer text-muted-foreground">
													{getLabel("toolCall.rawOutput")}
												</summary>
												<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
													{JSON.stringify(message.rawOutput, null, 2)}
												</pre>
											</details>
										) : null}
									</div>
								) : null}
							</div>
						</details>
					) : null}
				</div>
			</div>
		</div>
	);
};

type ThoughtItemContentProps = {
	message: Extract<ChatMessage, { kind: "thought" }>;
};

export const ThoughtItemContent = ({ message }: ThoughtItemContentProps) => {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col gap-1 items-start">
			<details className="w-full max-w-[85%]">
				<summary className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
					<span className="size-1.5 rounded-full bg-muted-foreground/50" />
					<span className="italic">
						{message.isStreaming ? t("thought.thinking") : t("thought.thought")}
					</span>
				</summary>
				<div className="mt-1 ml-3.5 pl-2 border-l border-muted text-xs text-muted-foreground">
					<LazyStreamdown>{message.content}</LazyStreamdown>
				</div>
			</details>
		</div>
	);
};

// Also export getStatusDotColor for reuse in ToolCallGroup summary
export { getStatusDotColor };

const MessageItemInner = ({
	message,
	onPermissionDecision,
	onOpenFilePreview,
}: MessageItemProps) => {
	const { t } = useTranslation();
	const getLabel = (key: string, options?: Record<string, unknown>) =>
		t(key, { defaultValue: key, ...options });
	const isUser = message.role === "user";

	// User message copy button state
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		if (message.kind !== "text" || !isUser) return;
		const text = extractUserMessageText(
			message as Extract<ChatMessage, { kind: "text" }>,
		);
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand("copy");
			document.body.removeChild(textarea);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}, [message, isUser]);

	if (message.kind === "status") {
		const badgeVariant =
			message.variant === "success"
				? "default"
				: message.variant === "warning"
					? "secondary"
					: message.variant === "error"
						? "destructive"
						: "outline";
		return (
			<div className="flex flex-col gap-1 items-start">
				<Card size="sm" className="max-w-[85%] border-border bg-background">
					<CardContent className="flex flex-col gap-2 text-sm">
						<div className="flex flex-wrap items-center gap-2 text-xs">
							<Badge variant={badgeVariant}>
								{getLabel("toolCall.status")}
							</Badge>
							<span className="text-foreground font-medium">
								{message.title}
							</span>
						</div>
						{message.description ? (
							<div className="text-muted-foreground text-xs">
								{message.description}
							</div>
						) : null}
					</CardContent>
				</Card>
			</div>
		);
	}
	if (message.kind === "permission") {
		const meta = message.toolCall?._meta;
		const toolLabel =
			message.toolCall?.title ??
			(meta?.name as string | undefined) ??
			getLabel("toolCall.toolCall");
		const toolId = message.toolCall?.toolCallId ?? message.requestId;
		const toolCommand = meta?.command as string | undefined;
		const toolArgs = (meta?.args as string[] | undefined)?.join(" ");
		const isDisabled =
			message.outcome !== undefined || message.decisionState === "submitting";
		return (
			<div className="flex flex-col gap-1 items-start">
				<Card size="sm" className="max-w-[85%] border-border bg-background">
					<CardContent className="flex flex-col gap-3 text-sm">
						<div className="flex flex-wrap items-center gap-2 text-xs">
							<Badge variant="outline">
								{getLabel("toolCall.permissionRequest")}
							</Badge>
							<span className="text-foreground font-medium">{toolLabel}</span>
							{toolId ? (
								<span className="text-muted-foreground">
									#{toolId.slice(0, 8)}
								</span>
							) : null}
						</div>
						{toolCommand ? (
							<div className="text-muted-foreground text-xs">
								{toolCommand}
								{toolArgs ? ` ${toolArgs}` : ""}
							</div>
						) : null}
						<div className="flex flex-wrap gap-2">
							{message.options.map((option) => (
								<Button
									key={option.optionId}
									size="sm"
									disabled={isDisabled}
									onClick={() =>
										onPermissionDecision?.({
											requestId: message.requestId,
											outcome: {
												outcome: "selected",
												optionId: option.optionId,
											},
										})
									}
								>
									{option.name ?? option.optionId}
								</Button>
							))}
							<Button
								variant="outline"
								size="sm"
								disabled={isDisabled}
								onClick={() =>
									onPermissionDecision?.({
										requestId: message.requestId,
										outcome: { outcome: "cancelled" },
									})
								}
							>
								{getLabel("toolCall.permissionDenied")}
							</Button>
						</div>
						{message.decisionState === "submitting" ? (
							<div className="text-muted-foreground text-xs">
								{getLabel("toolCall.permissionSubmitting")}
							</div>
						) : null}
						{message.outcome ? (
							<div className="text-muted-foreground text-xs">
								{message.outcome.outcome === "cancelled"
									? getLabel("toolCall.permissionDenied")
									: getLabel("toolCall.permissionAllowed", {
											optionId: message.outcome.optionId,
										})}
							</div>
						) : null}
					</CardContent>
				</Card>
			</div>
		);
	}
	if (message.kind === "tool_call") {
		return (
			<ToolCallItemContent
				message={message}
				onOpenFilePreview={onOpenFilePreview}
			/>
		);
	}
	// Thought messages: collapsible light block
	if (message.kind === "thought") {
		return <ThoughtItemContent message={message} />;
	}
	// User messages: bubble style with hover-reveal copy button
	if (isUser) {
		return (
			<div className="flex flex-col gap-1 items-end">
				<div className="group/user-msg flex items-center gap-1.5 max-w-[85%]">
					{!message.isStreaming && (
						<button
							type="button"
							className="shrink-0 flex items-center justify-center size-6 rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-all hover:text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 md:opacity-0 group-hover/user-msg:opacity-100 focus-visible:opacity-100"
							onClick={(e) => {
								e.stopPropagation();
								handleCopy();
							}}
							aria-label={t("chat.copyMessage")}
						>
							<HugeiconsIcon
								icon={copied ? Tick02Icon : Copy01Icon}
								size={14}
								aria-hidden="true"
							/>
						</button>
					)}
					<Card
						size="sm"
						className={cn(
							"border-primary/30 bg-primary/10 min-w-0",
							message.isStreaming ? "opacity-90" : "opacity-100",
						)}
					>
						<CardContent className="text-sm">
							{renderUserContent(message, onOpenFilePreview)}
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}
	// Assistant messages: no bubble, just bullet point + content
	return (
		<div className="flex flex-col gap-1 items-start">
			<div className="flex items-start gap-2 max-w-full">
				<span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" />
				<div
					className={cn(
						"min-w-0 text-sm",
						message.isStreaming ? "opacity-90" : "opacity-100",
					)}
				>
					<LazyStreamdown>{message.content}</LazyStreamdown>
				</div>
			</div>
		</div>
	);
};

export const MessageItem = memo(MessageItemInner);
