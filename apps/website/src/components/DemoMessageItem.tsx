import { Streamdown } from "streamdown";
import { Card, CardContent } from "@/components/ui/card";
import type { DisplayMessage } from "@/hooks/use-streaming-demo";
import { cn } from "@/lib/utils";

interface DemoMessageItemProps {
	message: DisplayMessage;
}

export function DemoMessageItem({ message }: DemoMessageItemProps) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<Card
					size="sm"
					className="max-w-[85%] border-primary/30 bg-primary/10 py-2"
				>
					<CardContent className="px-3 py-0">
						<p className="text-xs">{message.content}</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex gap-2 items-start",
				message.isStreaming ? "opacity-90" : "opacity-100",
			)}
		>
			<span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" />
			<div className="min-w-0 flex-1 text-sm">
				<Streamdown mode={message.isStreaming ? "streaming" : "static"}>
					{message.content}
				</Streamdown>
			</div>
		</div>
	);
}
