import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoFeature, DemoMessage } from "@/data/features";

export interface DisplayMessage {
	role: "user" | "assistant";
	content: string;
	isStreaming: boolean;
}

export function useStreamingDemo(features: DemoFeature[]) {
	const [activeFeatureId, setActiveFeatureId] = useState(features[0]?.id ?? "");
	const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
	const [isPlaying, setIsPlaying] = useState(false);
	const playedRef = useRef(new Set<string>());
	const abortRef = useRef<AbortController | null>(null);

	const playFeature = useCallback(
		async (feature: DemoFeature, signal: AbortSignal) => {
			setIsPlaying(true);
			setDisplayMessages([]);

			for (const msg of feature.messages) {
				if (signal.aborted) return;

				if (msg.role === "user") {
					await delay(msg.delay ?? 400, signal);
					if (signal.aborted) return;
					setDisplayMessages((prev) => [
						...prev,
						{ role: "user", content: msg.content, isStreaming: false },
					]);
				} else {
					await delay(msg.delay ?? 500, signal);
					if (signal.aborted) return;
					await streamAssistantMessage(msg, signal, setDisplayMessages);
				}
			}

			if (!signal.aborted) {
				playedRef.current.add(feature.id);
				setIsPlaying(false);
			}
		},
		[],
	);

	const showInstant = useCallback((feature: DemoFeature) => {
		setDisplayMessages(
			feature.messages.map((msg) => ({
				role: msg.role,
				content: msg.content,
				isStreaming: false,
			})),
		);
		setIsPlaying(false);
	}, []);

	const handleSetActiveFeature = useCallback((id: string) => {
		abortRef.current?.abort();
		setActiveFeatureId(id);
	}, []);

	useEffect(() => {
		const feature = features.find((f) => f.id === activeFeatureId);
		if (!feature) return;

		if (playedRef.current.has(feature.id)) {
			showInstant(feature);
			return;
		}

		const controller = new AbortController();
		abortRef.current = controller;
		playFeature(feature, controller.signal);

		return () => {
			controller.abort();
		};
	}, [activeFeatureId, features, playFeature, showInstant]);

	// Auto-play first feature after initial mount delay
	const firstFeature = features[0];
	useEffect(() => {
		if (!firstFeature) return;
		const timer = setTimeout(() => {
			if (!playedRef.current.has(firstFeature.id)) {
				setActiveFeatureId(firstFeature.id);
			}
		}, 800);
		return () => clearTimeout(timer);
	}, [firstFeature]);

	return {
		activeFeatureId,
		setActiveFeatureId: handleSetActiveFeature,
		displayMessages,
		isPlaying,
	};
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}

async function streamAssistantMessage(
	msg: DemoMessage,
	signal: AbortSignal,
	setMessages: Dispatch<SetStateAction<DisplayMessage[]>>,
) {
	const charsPerTick = msg.charsPerTick ?? 4;
	const content = msg.content;
	let charIndex = 0;

	// Add empty streaming message
	setMessages((prev) => [
		...prev,
		{ role: "assistant", content: "", isStreaming: true },
	]);

	while (charIndex < content.length) {
		if (signal.aborted) return;

		charIndex = Math.min(charIndex + charsPerTick, content.length);
		const partial = content.slice(0, charIndex);

		setMessages((prev) => {
			const next = [...prev];
			const last = next[next.length - 1];
			if (last?.role === "assistant") {
				next[next.length - 1] = {
					...last,
					content: partial,
					isStreaming: charIndex < content.length,
				};
			}
			return next;
		});

		await delay(16, signal);
	}
}
