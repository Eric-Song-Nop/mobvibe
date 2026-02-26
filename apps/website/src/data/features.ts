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

export interface FeatureGroup {
	key: string;
	label: string;
	features: DemoFeature[];
}

const featureGroupDefs = [
	{
		key: "intro",
		featureIds: ["what-is-mobvibe", "acp"],
	},
	{
		key: "getting-started",
		featureIds: ["install-login", "e2ee", "sessions", "cross-platform"],
	},
	{
		key: "features",
		featureIds: [
			"multi-machine",
			"streaming",
			"file-explorer",
			"git-integration",
		],
	},
] as const;

export function useFeatureGroups(): FeatureGroup[] {
	const { t } = useTranslation();

	return useMemo(
		() =>
			featureGroupDefs.map((group) => ({
				key: group.key,
				label: t(`sidebar.groups.${group.key}`),
				features: group.featureIds.map((id) => ({
					id,
					title: t(`features.${id}.title`),
					messages: t(`features.${id}.messages`, {
						returnObjects: true,
					}) as DemoMessage[],
				})),
			})),
		[t],
	);
}

export function useFeatures(): DemoFeature[] {
	const groups = useFeatureGroups();
	return useMemo(() => groups.flatMap((g) => g.features), [groups]);
}
