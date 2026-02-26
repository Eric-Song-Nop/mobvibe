import { useCallback, useMemo, useState } from "react";
import { DemoFooter } from "@/components/DemoFooter";
import { DemoHeader } from "@/components/DemoHeader";
import { DemoMessageList } from "@/components/DemoMessageList";
import { DemoSidebar } from "@/components/DemoSidebar";
import { useFeatureGroups, useFeatures } from "@/data/features";
import { useStreamingDemo } from "@/hooks/use-streaming-demo";

export default function App() {
	const featureGroups = useFeatureGroups();
	const features = useFeatures();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const { activeFeatureId, setActiveFeatureId, displayMessages } =
		useStreamingDemo(features);

	const activeFeatureTitle = useMemo(
		() => features.find((f) => f.id === activeFeatureId)?.title ?? "",
		[activeFeatureId, features],
	);

	const handleMenuToggle = useCallback(() => {
		setSidebarOpen((prev) => !prev);
	}, []);

	const handleSidebarClose = useCallback(() => {
		setSidebarOpen(false);
	}, []);

	return (
		<div className="app-root flex">
			<DemoSidebar
				groups={featureGroups}
				activeFeatureId={activeFeatureId}
				onFeatureSelect={setActiveFeatureId}
				open={sidebarOpen}
				onClose={handleSidebarClose}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<DemoHeader
					activeFeatureTitle={activeFeatureTitle}
					onMenuToggle={handleMenuToggle}
				/>
				<DemoMessageList messages={displayMessages} />
				<DemoFooter />
			</div>
		</div>
	);
}
