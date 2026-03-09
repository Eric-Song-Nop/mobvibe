import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCodeAccentTextClass } from "@/lib/code-highlight";

const THINKING_VERBS = [
	"Pondering",
	"Moseying",
	"Mulling",
	"Noodling",
	"Ruminating",
	"Cogitating",
];

const STREAMING_VERBS = [
	"Scribbling",
	"Composing",
	"Typing",
	"Penning",
	"Drafting",
];

function pickRandom(list: string[]): string {
	return list[Math.floor(Math.random() * list.length)];
}

export const ThinkingIndicator = memo(function ThinkingIndicator({
	isThinking = false,
}: {
	isThinking?: boolean;
}) {
	const { t } = useTranslation();
	const [verb, setVerb] = useState(() =>
		pickRandom(isThinking ? THINKING_VERBS : STREAMING_VERBS),
	);

	useEffect(() => {
		setVerb(pickRandom(isThinking ? THINKING_VERBS : STREAMING_VERBS));
	}, [isThinking]);

	return (
		<output
			className={`flex items-center gap-1.5 px-0 py-2 ${getCodeAccentTextClass("yellow")}`}
			aria-label={
				isThinking ? t("chat.agentThinking") : t("chat.agentResponding")
			}
		>
			<span className="sparkle-breathing" aria-hidden="true">
				✦
			</span>
			<span className="select-none text-sm" aria-hidden="true">
				{verb}...
			</span>
		</output>
	);
});
