import i18n from "i18next";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import App from "@/App";
import { ThemeProvider } from "@/components/theme-provider";
import en from "@/i18n/locales/en/translation.json";
import zh from "@/i18n/locales/zh/translation.json";
import {
	resolveWebsitePage,
	type WebsitePageMeta,
	websitePrerenderPaths,
} from "@/lib/page-info";

// Server-side i18n: no LanguageDetector, fixed to English for SEO
const serverI18n = i18n.createInstance();
void serverI18n.use(initReactI18next).init({
	resources: {
		en: { translation: en },
		zh: { translation: zh },
	},
	lng: "en",
	fallbackLng: "en",
	interpolation: {
		escapeValue: false,
	},
});

export function render(pathname = "/"): {
	html: string;
	meta: WebsitePageMeta;
} {
	const page = resolveWebsitePage(pathname);

	return {
		html: renderToString(
			<StrictMode>
				<I18nextProvider i18n={serverI18n}>
					<ThemeProvider>
						<App pathname={page.pathname} />
					</ThemeProvider>
				</I18nextProvider>
			</StrictMode>,
		),
		meta: page.meta,
	};
}

export { websitePrerenderPaths };
