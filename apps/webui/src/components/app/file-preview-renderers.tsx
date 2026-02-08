import { lazy, Suspense } from "react";
import { ImagePreview } from "@/components/app/previews/ImagePreview";
import type { PreviewRendererRegistry } from "@/components/app/previews/preview-renderer";
import "@/components/app/previews/preview.css";

const LazyCodePreview = lazy(async () => {
	const module = await import("@/components/app/previews/CodePreview");
	return { default: module.CodePreview };
});

export const previewRenderers: PreviewRendererRegistry = {
	code: (payload, sessionId) => (
		<Suspense fallback={<div className="text-muted-foreground p-4 text-sm" />}>
			<LazyCodePreview payload={payload} sessionId={sessionId} />
		</Suspense>
	),
	image: (payload) => <ImagePreview payload={payload} />,
};
