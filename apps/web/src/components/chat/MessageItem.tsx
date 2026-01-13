import { Streamdown } from "streamdown";
import { Card, CardContent } from "@/components/ui/card";
import { type ChatMessage } from "@/lib/chat-store";
import { cn } from "@/lib/utils";

type MessageItemProps = {
	message: ChatMessage;
};

export const MessageItem = ({ message }: MessageItemProps) => {
	const isUser = message.role === "user";
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
