import type { PreviewRendererRegistry } from "@/components/app/previews";
import { CodePreview, ImagePreview } from "@/components/app/previews";

export const previewRenderers: PreviewRendererRegistry = {
	code: (payload) => <CodePreview payload={payload} />,
	image: (payload) => <ImagePreview payload={payload} />,
};
