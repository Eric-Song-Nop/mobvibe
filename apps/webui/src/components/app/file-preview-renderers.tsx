import type { PreviewRendererRegistry } from "@/components/app/previews";
import { CodePreview, ImagePreview } from "@/components/app/previews";

export const previewRenderers: PreviewRendererRegistry = {
	code: (payload, sessionId) => (
		<CodePreview payload={payload} sessionId={sessionId} />
	),
	image: (payload) => <ImagePreview payload={payload} />,
};
