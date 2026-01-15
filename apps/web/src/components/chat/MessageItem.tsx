import { Streamdown } from "streamdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PermissionOutcome } from "@/lib/acp";
import { type ChatMessage } from "@/lib/chat-store";
import { cn } from "@/lib/utils";

type PermissionDecisionPayload = {
	requestId: string;
	outcome: PermissionOutcome;
};

type MessageItemProps = {
	message: ChatMessage;
	onPermissionDecision?: (payload: PermissionDecisionPayload) => void;
};

export const MessageItem = ({
	message,
	onPermissionDecision,
}: MessageItemProps) => {
	const isUser = message.role === "user";
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
