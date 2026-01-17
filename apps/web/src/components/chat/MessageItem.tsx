import { Streamdown } from "streamdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PermissionOutcome } from "@/lib/acp";
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
};

const TerminalOutputBlock = ({
	terminalId,
	output,
	truncated,
	exitStatus,
}: TerminalOutputBlockProps) => (
	<div className="rounded border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground">
		<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
			{output && output.length > 0 ? output : "(无输出)"}
		</pre>
		{exitStatus ? (
			<div className="mt-1 text-[11px] text-muted-foreground">
				结束: {exitStatus.exitCode ?? "-"}
				{exitStatus.signal ? ` (${exitStatus.signal})` : ""}
			</div>
		) : null}
		{truncated ? (
			<div className="mt-1 text-[11px] text-muted-foreground">输出已截断</div>
		) : null}
		{!output ? (
			<div className="mt-1 text-[11px] text-muted-foreground">
				终端输出等待中（{terminalId}）
			</div>
		) : null}
	</div>
);

const resolveFileName = (pathValue: string) => {
	const parts = pathValue.split(/[/\\]/).filter(Boolean);
	return parts.at(-1) ?? pathValue;
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

const resolveStatusLabel = (status?: string) => {
	if (!status) {
		return "未知";
	}
	switch (status) {
		case "pending":
			return "等待";
		case "in_progress":
			return "进行中";
		case "completed":
			return "完成";
		case "failed":
			return "失败";
		default:
			return "未知";
	}
};

const TOOL_CALL_PATH_SUMMARY_LIMIT = 3;

export const MessageItem = ({
	message,
	onPermissionDecision,
	onOpenFilePreview,
}: MessageItemProps) => {
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
							<Badge variant={badgeVariant}>状态</Badge>
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
			message.toolCall?.title ?? message.toolCall?.name ?? "工具调用";
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
							<Badge variant="outline">权限请求</Badge>
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
								拒绝
							</Button>
						</div>
						{message.decisionState === "submitting" ? (
							<div className="text-muted-foreground text-xs">
								正在提交权限选择...
							</div>
						) : null}
						{message.outcome ? (
							<div className="text-muted-foreground text-xs">
								{message.outcome.outcome === "cancelled"
									? "已拒绝"
									: `已允许: ${message.outcome.optionId}`}
							</div>
						) : null}
					</CardContent>
				</Card>
			</div>
		);
	}
	if (message.kind === "tool_call") {
		const label = message.title ?? message.name ?? "工具调用";
		const statusLabel = resolveStatusLabel(message.status);
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
		const textOutputs = message.content?.flatMap((contentBlock) => {
			if (contentBlock.type !== "content") {
				return [];
			}
			const content = contentBlock.content;
			if (typeof content === "string") {
				return [content];
			}
			if (
				content &&
				typeof content === "object" &&
				"type" in content &&
				content.type === "text" &&
				"text" in content &&
				typeof content.text === "string"
			) {
				return [content.text];
			}
			return [];
		});
		const terminalIds = message.content?.flatMap((contentBlock) =>
			contentBlock.type === "terminal" ? [contentBlock.terminalId] : [],
		);
		const terminalOutputMap = message.sessionId
			? terminalOutputs[message.sessionId]?.terminalOutputs
			: undefined;
		const hasOutputs = Boolean(
			(textOutputs && textOutputs.length > 0) ||
				(terminalIds && terminalIds.length > 0) ||
				message.rawOutput,
		);
		return (
			<div className="flex flex-col gap-1 items-start">
				<Card size="sm" className="max-w-[85%] border-border bg-background">
					<CardContent className="flex flex-col gap-3 text-sm">
						<details className="group">
							<summary className="flex flex-wrap items-center gap-2 text-xs cursor-pointer list-none">
								<Badge variant="outline">工具调用</Badge>
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
											输出
										</summary>
										<div className="mt-2 flex flex-col gap-2 text-xs">
											{textOutputs?.map((text, index) => (
												<Streamdown key={`${message.toolCallId}-text-${index}`}>
													{text}
												</Streamdown>
											))}
											{terminalIds?.map((terminalId) => {
												const output = terminalOutputMap?.[terminalId];
												return (
													<TerminalOutputBlock
														key={`${message.toolCallId}-${terminalId}`}
														terminalId={terminalId}
														output={output?.output}
														truncated={output?.truncated}
														exitStatus={output?.exitStatus}
													/>
												);
											})}
											{message.rawOutput ? (
												<details className="rounded border border-border bg-background/80 px-2 py-1">
													<summary className="cursor-pointer text-xs text-muted-foreground">
														原始输出
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
					<Streamdown>{message.content}</Streamdown>
				</CardContent>
			</Card>
		</div>
	);
};
