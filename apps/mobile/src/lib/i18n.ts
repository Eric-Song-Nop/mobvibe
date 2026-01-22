import {
	I18N_STORAGE_KEY,
	resolveSupportedLanguage,
	translations,
} from "@remote-claude/core/i18n";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const getDeviceLanguage = (): string => {
	try {
		const locales = getLocales();
		if (locales.length > 0 && locales[0].languageCode) {
			return locales[0].languageCode;
		}
	} catch (error) {
		console.warn("Failed to get device language:", error);
	}
	return "en";
};

export const initI18n = async () => {
	// Try to load stored language preference
	let storedLanguage: string | null = null;
	try {
		storedLanguage = await SecureStore.getItemAsync(I18N_STORAGE_KEY);
	} catch (error) {
		console.warn("Failed to load stored language:", error);
	}

	const detectedLanguage = resolveSupportedLanguage(
		storedLanguage ?? getDeviceLanguage(),
	);

	await i18n.use(initReactI18next).init({
		resources: translations,
		lng: detectedLanguage,
		fallbackLng: "en",
		supportedLngs: ["zh", "en"],
		nonExplicitSupportedLngs: true,
		interpolation: {
			escapeValue: false,
		},
	});

	return i18n;
};

export const changeLanguage = async (language: string) => {
	const resolved = resolveSupportedLanguage(language);
	await i18n.changeLanguage(resolved);
	try {
		await SecureStore.setItemAsync(I18N_STORAGE_KEY, resolved);
	} catch (error) {
		console.warn("Failed to save language preference:", error);
	}
};

export { i18n };
