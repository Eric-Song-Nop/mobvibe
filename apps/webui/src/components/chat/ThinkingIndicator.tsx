import { memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

const GLYPHS =
	"░▒▓█▄▀▐▌─│┌┐└┘├┤┬┴┼╌╍╎╏═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬∀∂∃∅∇∈∉∋∏∑−∗√∝∞∠∧∨∩∪∫≈≠≡≤≥⊂⊃⊄⊆⊇⊕⊗⊥⋅";

const GIBBERISH_LENGTH = 12;
const TICK_MS = 80;

function generateGibberish(): string {
	let result = "";
	for (let i = 0; i < GIBBERISH_LENGTH; i++) {
		result += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
	}
	return result;
}

export const ThinkingIndicator = memo(function ThinkingIndicator({
	isThinking = false,
}: {
	isThinking?: boolean;
}) {
	const { t } = useTranslation();
	const textRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const prefersReduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (prefersReduced) {
			return;
		}

		const prefix = isThinking ? "thinking: " : "";
		const id = setInterval(() => {
			if (textRef.current) {
				textRef.current.textContent = `${prefix}${generateGibberish()}`;
			}
		}, TICK_MS);
		return () => clearInterval(id);
	}, [isThinking]);

	const prefix = isThinking ? "thinking: " : "";

	return (
		<output
			className="flex items-start gap-2 px-0 py-2"
			aria-label={
				isThinking ? t("chat.agentThinking") : t("chat.agentResponding")
			}
		>
			<span
				className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground"
				style={{ animation: "breathing 1.5s ease-in-out infinite" }}
			/>
			<span
				ref={textRef}
				className="text-muted-foreground select-none text-sm"
				aria-hidden="true"
			>
				{`${prefix}${generateGibberish()}`}
			</span>
		</output>
	);
});
