import type { SessionFsFilePreviewResponse } from "@/lib/api";

export type ImagePreviewProps = {
	payload: SessionFsFilePreviewResponse;
};

export function ImagePreview({ payload }: ImagePreviewProps) {
	const src = payload.content;

	return (
		<div className="file-preview-image">
			<div className="file-preview-image__container">
				<img
					src={src}
					alt={payload.path}
					className="file-preview-image__content"
				/>
			</div>
		</div>
	);
}
