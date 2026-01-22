import i18n from "i18next";
import en from "./locales/en/translation.json";
import zh from "./locales/zh/translation.json";

export const I18N_STORAGE_KEY = "mobvibe.locale";

export const supportedLanguages = ["zh", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const resolveSupportedLanguage = (
	language?: string | null,
): SupportedLanguage => {
	if (!language) {
		return "en";
	}
	const normalized = language.toLowerCase();
	if (normalized.startsWith("zh")) {
		return "zh";
	}
	return "en";
};

export const translations = {
	en: { translation: en },
	zh: { translation: zh },
};

// Base i18n configuration (platform-specific setup should call initI18n)
export type I18nConfig = {
	languageDetector?: {
		detect: () => string | undefined;
		cacheUserLanguage?: (language: string) => void;
	};
	fallbackLng?: SupportedLanguage;
};

export const initI18n = async (config?: I18nConfig) => {
	const { languageDetector, fallbackLng = "en" } = config ?? {};

	// Detect language
	let detectedLanguage = fallbackLng;
	if (languageDetector?.detect) {
		const detected = languageDetector.detect();
		if (detected) {
			detectedLanguage = resolveSupportedLanguage(detected);
		}
	}

	await i18n.init({
		resources: translations,
		lng: detectedLanguage,
		fallbackLng,
		supportedLngs: supportedLanguages,
		nonExplicitSupportedLngs: true,
		interpolation: {
			escapeValue: false,
		},
	});

	return i18n;
};

export { i18n };
export default i18n;
