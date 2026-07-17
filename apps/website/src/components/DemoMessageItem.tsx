import { Bubble, BubbleContent } from "@mobvibe/ui/bubble";
import { Message, MessageAvatar, MessageContent } from "@mobvibe/ui/message";
import { Streamdown } from "streamdown";
import type { DisplayMessage } from "@/hooks/use-streaming-demo";

interface DemoMessageItemProps {
	message: DisplayMessage;
}

export function DemoMessageItem({ message }: DemoMessageItemProps) {
	if (message.role === "user") {
		return (
			<Message align="end">
				<MessageContent>
					<Bubble variant="tinted" align="end" className="max-w-[85%]">
						<BubbleContent>
							<p className="text-xs">{message.content}</p>
						</BubbleContent>
					</Bubble>
				</MessageContent>
			</Message>
		);
	}

	return (
		<Message className={message.isStreaming ? "opacity-90" : "opacity-100"}>
			<MessageAvatar className="mt-1 min-w-4 self-start bg-transparent">
				<span
					className="size-2 rounded-full bg-foreground"
					aria-hidden="true"
				/>
			</MessageAvatar>
			<MessageContent>
				<Bubble variant="ghost">
					<BubbleContent className="text-sm">
						<Streamdown mode={message.isStreaming ? "streaming" : "static"}>
							{message.content}
						</Streamdown>
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}
