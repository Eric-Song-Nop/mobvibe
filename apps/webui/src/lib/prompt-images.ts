import {
	isPromptImageMimeType,
	PROMPT_IMAGE_MAX_BYTES,
	PROMPT_IMAGE_MAX_EDGE,
	type PromptImageMimeType,
	validatePromptImageBlocks,
} from "@mobvibe/shared";
import type { ContentBlock } from "@/lib/acp";

type ImageContent = Extract<ContentBlock, { type: "image" }>;

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/;

const readFileAsDataUrl = (file: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
				return;
			}
			reject(new Error("Failed to read image data"));
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error("Failed to read image data"));
		};
		reader.readAsDataURL(file);
	});

const dataUrlToImageContent = (
	dataUrl: string,
	options?: { uri?: string | null },
): ImageContent => {
	const match = DATA_URL_PATTERN.exec(dataUrl);
	if (!match) {
		throw new Error("Invalid image data URL");
	}
	const [, mimeType, data] = match;
	if (!isPromptImageMimeType(mimeType)) {
		throw new Error(`Unsupported image MIME type: ${mimeType}`);
	}
	return {
		type: "image",
		data,
		mimeType,
		uri: options?.uri ?? null,
	};
};

const validateSingleImage = (image: ImageContent): ImageContent => {
	const result = validatePromptImageBlocks([image]);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return image;
};

const loadImageElement = (dataUrl: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Failed to decode image"));
		image.src = dataUrl;
	});

const canvasToBlob = (
	canvas: HTMLCanvasElement,
	type: PromptImageMimeType,
	quality?: number,
): Promise<Blob> =>
	new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error("Failed to encode image"));
					return;
				}
				resolve(blob);
			},
			type,
			quality,
		);
	});

const buildOutputTypes = (
	originalType: PromptImageMimeType,
): PromptImageMimeType[] => {
	switch (originalType) {
		case "image/jpeg":
			return ["image/jpeg", "image/webp"];
		case "image/png":
			return ["image/png", "image/webp", "image/jpeg"];
		case "image/webp":
			return ["image/webp", "image/jpeg"];
		case "image/gif":
			return ["image/gif"];
	}
};

const buildQualities = (mimeType: PromptImageMimeType) =>
	mimeType === "image/png" || mimeType === "image/gif"
		? [undefined]
		: [0.92, 0.82, 0.72, 0.6, 0.5, 0.4];

const normalizeRasterImage = async (
	file: File,
	mimeType: PromptImageMimeType,
): Promise<ImageContent> => {
	const inputDataUrl = await readFileAsDataUrl(file);
	const image = await loadImageElement(inputDataUrl);
	const scaleCap = Math.min(
		1,
		PROMPT_IMAGE_MAX_EDGE /
			Math.max(image.naturalWidth || 1, image.naturalHeight || 1),
	);
	const scales = [scaleCap, scaleCap * 0.85, scaleCap * 0.7, scaleCap * 0.55]
		.filter(
			(value, index, values) => value > 0 && values.indexOf(value) === index,
		)
		.map((value) => Math.min(1, value));
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Failed to create image canvas");
	}

	for (const scale of scales) {
		const width = Math.max(1, Math.round(image.naturalWidth * scale));
		const height = Math.max(1, Math.round(image.naturalHeight * scale));
		canvas.width = width;
		canvas.height = height;
		context.clearRect(0, 0, width, height);
		context.drawImage(image, 0, 0, width, height);

		for (const outputType of buildOutputTypes(mimeType)) {
			for (const quality of buildQualities(outputType)) {
				const blob = await canvasToBlob(canvas, outputType, quality);
				if (blob.size > PROMPT_IMAGE_MAX_BYTES) {
					continue;
				}
				return validateSingleImage(
					dataUrlToImageContent(await readFileAsDataUrl(blob)),
				);
			}
		}
	}

	throw new Error(
		`Image exceeds ${PROMPT_IMAGE_MAX_BYTES / 1024} KiB after normalization`,
	);
};

export const normalizeImageFileForPrompt = async (
	file: File,
): Promise<ImageContent> => {
	if (!isPromptImageMimeType(file.type)) {
		throw new Error(`Unsupported image MIME type: ${file.type || "unknown"}`);
	}
	if (file.type === "image/gif") {
		return validateSingleImage(
			dataUrlToImageContent(await readFileAsDataUrl(file)),
		);
	}
	return normalizeRasterImage(file, file.type);
};
