import { describe, expect, it } from "vitest";
import enTranslations from "../locales/en/translation.json";
import zhTranslations from "../locales/zh/translation.json";

const placementNeutralWorkspaceGuidance = [
	{
		locale: "en",
		resource: enTranslations,
		expected: "Choose a workspace to create an Agent Team.",
	},
	{
		locale: "zh",
		resource: zhTranslations,
		expected: "请选择一个工作区以创建 Agent Team。",
	},
] as const;

describe("Agent Team translations", () => {
	it.each(
		placementNeutralWorkspaceGuidance,
	)("provides real placement-neutral workspace guidance for $locale", ({
		resource,
		expected,
	}) => {
		const errors = resource.errors as Record<string, string>;

		expect(errors.agentTeamWorkspaceContextRequired).toBe(expected);
		expect(errors.agentTeamWorkspaceContextRequired).not.toMatch(
			/machine|机器/i,
		);
	});
});
