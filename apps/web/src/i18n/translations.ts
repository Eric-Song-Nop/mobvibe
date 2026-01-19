import type { TFunction } from "i18next";

const isStringKey = (value: unknown): value is string | string[] =>
	typeof value === "string" || Array.isArray(value);

export const translateTemplate = (t: TFunction, key: string): string => {
	const result = t(key, { defaultValue: key, returnObjects: true });
	if (isStringKey(result)) {
		return Array.isArray(result) ? result.join(" ") : result;
	}
	return key;
};
