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

export const ThinkingIndicator = memo(function ThinkingIndicator() {
	const { t } = useTranslation();
	const textRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const prefersReduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (prefersReduced) {
			return;
		}

		const id = setInterval(() => {
			if (textRef.current) {
				textRef.current.textContent = generateGibberish();
			}
		}, TICK_MS);
		return () => clearInterval(id);
	}, []);

	return (
		<output
			className="flex items-start gap-2 px-0 py-2"
			aria-label={t("chat.agentThinking")}
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
				{generateGibberish()}
			</span>
		</output>
	);
});
