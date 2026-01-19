import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
	AudioContent,
	ContentBlock,
	ImageContent,
	PermissionOutcome,
	ResourceContent,
	ResourceLinkContent,
	ToolCallContent,
	ToolCallContentPayload,
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
		: content.uri;
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
			{canPreviewInline ? (
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
			</audio>
		</div>
	);
};

const renderResourceContent = (
	content: ResourceContent,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const label = resolveResourceLabel(content.resource.uri);
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
			{content.resource.text ? (
				<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
					{content.resource.text}
				</pre>
			) : content.resource.blob ? (
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

const renderResourceLinkContent = (
	content: ResourceLinkContent,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const label = resolveResourceLabel(content.uri, content.name, content.title);
	const meta = [
		content.mimeType,
		content.size !== undefined ? formatBytes(content.size) : null,
	]
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

const renderUserContent = (
	message: Extract<ChatMessage, { kind: "text" }>,
	onOpenFilePreview?: (path: string) => void,
) => {
	const contentBlocks = message.contentBlocks ?? [];
	if (contentBlocks.length === 0) {
		return <Streamdown>{message.content}</Streamdown>;
	}
	const parts = contentBlocks.map((block, index) => {
		if (block.type === "text") {
			return <Streamdown key={`text-${index}`}>{block.text}</Streamdown>;
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
			return renderResourceContent(content, key, getLabel, onOpenFilePreview);
		case "resource_link":
			return renderResourceLinkContent(
				content,
				key,
				getLabel,
				onOpenFilePreview,
			);
		default:
			return renderUnknownContent(content, key);
	}
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
	content: Extract<ToolCallContent, { type: "diff" }>,
	key: string,
	getLabel: (key: string, options?: Record<string, unknown>) => string,
	onOpenFilePreview?: (path: string) => void,
) => {
	const label = resolveFileName(content.path);
	return (
		<div
			key={key}
			className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground"
		>
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span>{getLabel("toolCall.diff")}</span>
				{onOpenFilePreview ? (
					<button
						type="button"
						className="text-xs text-primary hover:underline"
						onClick={(event) => {
							event.preventDefault();
							onOpenFilePreview(content.path);
						}}
					>
						{label}
					</button>
				) : (
					<span className="text-xs text-foreground">{label}</span>
				)}
			</div>
			<div className="mt-2 space-y-2">
				<div>
					<div className="text-[11px] text-muted-foreground">
						{getLabel("toolCall.original")}
					</div>
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
						{content.oldText ?? getLabel("toolCall.newFile")}
					</pre>
				</div>
				<div>
					<div className="text-[11px] text-muted-foreground">
						{getLabel("toolCall.updated")}
					</div>
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
						{content.newText}
					</pre>
				</div>
			</div>
		</div>
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
	if (rawPath) {
		paths.add(rawPath);
	}
	const rawPaths = parseRawInputValue<unknown[]>(message.rawInput, "paths");
	if (Array.isArray(rawPaths)) {
		rawPaths.forEach((entry) => {
			if (typeof entry === "string") {
				paths.add(entry);
			}
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

export const MessageItem = ({
	message,
	onPermissionDecision,
	onOpenFilePreview,
}: MessageItemProps) => {
	const { t } = useTranslation();
	const getLabel = (key: string, options?: Record<string, unknown>) =>
		t(key, { defaultValue: key, ...options });
	const isUser = message.role === "user";
	const terminalOutputs = useChatStore((state) => state.sessions);
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
		const toolLabel =
			message.toolCall?.title ??
			message.toolCall?.name ??
			getLabel("toolCall.toolCall");
		const toolId = message.toolCall?.toolCallId ?? message.requestId;
		const toolCommand = message.toolCall?.command;
		const toolArgs = message.toolCall?.args?.join(" ");
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
									{option.label ?? option.optionId}
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
		const label =
			message.title ?? message.name ?? getLabel("toolCall.toolCall");
		const statusLabel = resolveStatusLabel(message.status, getLabel);
		const durationLabel =
			message.duration !== undefined ? `${message.duration}ms` : undefined;
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
		const overflowCount = Math.max(
			0,
			displayPaths.length - summaryPaths.length,
		);
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
		const terminalOutputMap = message.sessionId
			? terminalOutputs[message.sessionId]?.terminalOutputs
			: undefined;
		const hasOutputs = Boolean(
			(outputBlocks && outputBlocks.some(Boolean)) ||
				(terminalIds && terminalIds.length > 0) ||
				message.rawOutput,
		);
		return (
			<div className="flex flex-col gap-1 items-start">
				<Card size="sm" className="max-w-[85%] border-border bg-background">
					<CardContent className="flex flex-col gap-3 text-sm">
						<details className="group">
							<summary className="flex flex-wrap items-center gap-2 text-xs cursor-pointer list-none">
								<Badge variant="outline">{getLabel("toolCall.toolCall")}</Badge>
								<span className="text-foreground font-medium">{label}</span>
								{message.status ? (
									<Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
								) : null}
								{durationLabel ? (
									<span className="text-muted-foreground">{durationLabel}</span>
								) : null}
								{summaryPaths.length > 0 ? (
									<div className="flex flex-wrap items-center gap-1">
										{summaryPaths.map((item) => (
											<button
												key={item.path}
												type="button"
												className="text-xs text-primary hover:underline"
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
											<span className="text-muted-foreground">
												+{overflowCount}
											</span>
										) : null}
									</div>
								) : null}
							</summary>
							<div className="mt-2 flex flex-col gap-2 text-xs">
								{commandLine ? (
									<div className="text-muted-foreground">{commandLine}</div>
								) : null}
								{message.error ? (
									<div className="text-destructive">{message.error}</div>
								) : null}
								{hasOutputs ? (
									<details className="rounded border border-border bg-muted/30 px-2 py-1">
										<summary className="cursor-pointer text-xs text-muted-foreground">
											{getLabel("toolCall.output")}
										</summary>
										<div className="mt-2 flex flex-col gap-2 text-xs">
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
											{message.rawOutput ? (
												<details className="rounded border border-border bg-background/80 px-2 py-1">
													<summary className="cursor-pointer text-xs text-muted-foreground">
														{getLabel("toolCall.rawOutput")}
													</summary>
													<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
														{JSON.stringify(message.rawOutput, null, 2)}
													</pre>
												</details>
											) : null}
										</div>
									</details>
								) : null}
							</div>
						</details>
					</CardContent>
				</Card>
			</div>
		);
	}
	return (
		<div
			className={cn(
				"flex flex-col gap-1",
				isUser ? "items-end" : "items-start",
			)}
		>
			<Card
				size="sm"
				className={cn(
					"max-w-[85%]",
					isUser
						? "border-primary/30 bg-primary/10"
						: "border-border bg-background",
					message.isStreaming ? "opacity-90" : "opacity-100",
				)}
			>
				<CardContent className="text-sm">
					{renderUserContent(message, onOpenFilePreview)}
				</CardContent>
			</Card>
		</div>
	);
};
