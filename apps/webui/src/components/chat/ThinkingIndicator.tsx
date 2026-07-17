import { Marker, MarkerContent, MarkerIcon } from "@mobvibe/ui/marker";
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
		<Marker asChild className={`py-2 ${getCodeAccentTextClass("yellow")}`}>
			<output
				aria-label={
					isThinking ? t("chat.agentThinking") : t("chat.agentResponding")
				}
			>
				<MarkerIcon>
					<span className="sparkle-breathing">✦</span>
				</MarkerIcon>
				<MarkerContent className="select-none">{verb}…</MarkerContent>
			</output>
		</Marker>
	);
});
