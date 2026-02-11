import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface DemoMessage {
	role: "user" | "assistant";
	content: string;
	delay?: number;
	charsPerTick?: number;
}

export interface DemoFeature {
	id: string;
	title: string;
	messages: DemoMessage[];
}

const featureIds = [
	"multi-machine",
	"streaming",
	"sessions",
	"file-explorer",
	"e2ee",
	"cross-platform",
	"acp",
] as const;

export function useFeatures(): DemoFeature[] {
	const { t } = useTranslation();

	return useMemo(
		() =>
			featureIds.map((id) => ({
				id,
				title: t(`features.${id}.title`),
				messages: t(`features.${id}.messages`, {
					returnObjects: true,
				}) as DemoMessage[],
			})),
		[t],
	);
}
