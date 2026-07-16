import { SidebarProvider } from "@mobvibe/ui/sidebar";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DemoFooter } from "@/components/DemoFooter";
import { DemoHeader } from "@/components/DemoHeader";
import { DemoMessageList } from "@/components/DemoMessageList";
import { DemoSidebar } from "@/components/DemoSidebar";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { PricingPage } from "@/components/PricingPage";
import { useFeatureGroups, useFeatures } from "@/data/features";
import { useStreamingDemo } from "@/hooks/use-streaming-demo";
import { resolveWebsitePage } from "@/lib/page-info";

type AppProps = {
	pathname?: string;
};

export default function App({ pathname }: AppProps) {
	const page = resolveWebsitePage(
		pathname ??
			(typeof window === "undefined" ? "/" : window.location.pathname),
	);

	if (page.kind === "legal") {
		return <LegalDocumentPage documentId={page.documentId} />;
	}

	if (page.kind === "pricing") {
		return <PricingPage />;
	}

	return <MarketingHome />;
}

function MarketingHome() {
	const { t } = useTranslation();
	const featureGroups = useFeatureGroups();
	const features = useFeatures();
	const { activeFeatureId, setActiveFeatureId, displayMessages } =
		useStreamingDemo(features);

	const activeFeatureTitle = useMemo(
		() => features.find((f) => f.id === activeFeatureId)?.title ?? "",
		[activeFeatureId, features],
	);

	return (
		<SidebarProvider className="app-root h-svh overflow-hidden">
			<a
				href="#main-content"
				className="sr-only fixed top-3 left-3 z-60 bg-background px-3 py-2 text-sm focus:not-sr-only focus-visible:ring-2 focus-visible:ring-ring"
			>
				{t("common.skipToContent")}
			</a>
			<DemoSidebar
				groups={featureGroups}
				activeFeatureId={activeFeatureId}
				onFeatureSelect={setActiveFeatureId}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<DemoHeader
					currentPathname="/"
					activeFeatureTitle={activeFeatureTitle}
					showSidebarTrigger
				/>
				<DemoMessageList messages={displayMessages} />
				<DemoFooter />
			</div>
		</SidebarProvider>
	);
}
