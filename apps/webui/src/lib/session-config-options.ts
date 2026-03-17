import type {
	SessionConfigOption,
	SessionModelOption,
	SessionModeOption,
} from "@mobvibe/shared";
import type { SessionConfigSelect } from "./acp";

type SelectSessionConfigOption = Extract<
	SessionConfigOption,
	{ type: "select" }
>;

type DerivedModeState = {
	modeId?: string;
	modeName?: string;
	availableModes?: SessionModeOption[];
};

type DerivedModelState = {
	modelId?: string;
	modelName?: string;
	availableModels?: SessionModelOption[];
};

export const isSelectSessionConfigOption = (
	option: SessionConfigOption,
): option is SelectSessionConfigOption => option.type === "select";

export const isBooleanSessionConfigOption = (
	option: SessionConfigOption,
): option is Extract<SessionConfigOption, { type: "boolean" }> =>
	option.type === "boolean";

export const flattenSessionConfigSelectOptions = (
	option: SessionConfigSelect,
) =>
	option.options.flatMap((entry) =>
		"options" in entry ? entry.options : [entry],
	);

export const findConfigOptionByCategory = (
	configOptions: SessionConfigOption[] | undefined,
	category: string,
) =>
	configOptions?.find(
		(option): option is SelectSessionConfigOption =>
			option.category === category && isSelectSessionConfigOption(option),
	);

export const deriveModeStateFromConfigOptions = (
	configOptions: SessionConfigOption[] | undefined,
): DerivedModeState => {
	const option = findConfigOptionByCategory(configOptions, "mode");
	if (!option) {
		return {};
	}
	const choices = flattenSessionConfigSelectOptions(option);
	const modeId =
		typeof option.currentValue === "string" ? option.currentValue : undefined;
	return {
		modeId,
		modeName: choices.find((choice) => choice.value === modeId)?.name,
		availableModes: choices.map((choice) => ({
			id: choice.value,
			name: choice.name,
		})),
	};
};

export const deriveModelStateFromConfigOptions = (
	configOptions: SessionConfigOption[] | undefined,
): DerivedModelState => {
	const option = findConfigOptionByCategory(configOptions, "model");
	if (!option) {
		return {};
	}
	const choices = flattenSessionConfigSelectOptions(option);
	const modelId =
		typeof option.currentValue === "string" ? option.currentValue : undefined;
	return {
		modelId,
		modelName: choices.find((choice) => choice.value === modelId)?.name,
		availableModels: choices.map((choice) => ({
			id: choice.value,
			name: choice.name,
			description: choice.description ?? undefined,
		})),
	};
};

export const getAdditionalSessionConfigOptions = (
	configOptions: SessionConfigOption[] | undefined,
) =>
	(configOptions ?? []).filter(
		(option) => option.category !== "mode" && option.category !== "model",
	);
