import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
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

void i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources: {
			en: { translation: en },
			zh: { translation: zh },
		},
		fallbackLng: "en",
		supportedLngs: supportedLanguages,
		nonExplicitSupportedLngs: true,
		interpolation: {
			escapeValue: false,
		},
		detection: {
			order: ["localStorage", "navigator"],
			caches: ["localStorage"],
			lookupLocalStorage: I18N_STORAGE_KEY,
		},
	});

export default i18n;
