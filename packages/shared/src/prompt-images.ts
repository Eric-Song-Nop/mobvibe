import type { ContentBlock } from "./types/acp.js";

type ImageContent = Extract<ContentBlock, { type: "image" }>;

export const PROMPT_IMAGE_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;

export const PROMPT_IMAGE_MAX_COUNT = 3;
export const PROMPT_IMAGE_MAX_BYTES = 512 * 1024;
export const PROMPT_IMAGE_MAX_TOTAL_BYTES = 1536 * 1024;
export const PROMPT_IMAGE_MAX_EDGE = 1600;

export type PromptImageMimeType = (typeof PROMPT_IMAGE_MIME_TYPES)[number];

export type PromptImageValidationSuccess = {
	ok: true;
	imageCount: number;
	totalBytes: number;
};

export type PromptImageValidationFailure = {
	ok: false;
	message: string;
};

export type PromptImageValidationResult =
	| PromptImageValidationSuccess
	| PromptImageValidationFailure;

const promptImageMimeTypes = new Set<string>(PROMPT_IMAGE_MIME_TYPES);

const IMAGE_PATH_MIME_ENTRIES: Array<[RegExp, PromptImageMimeType]> = [
	[/\.png$/i, "image/png"],
	[/\.(jpe?g)$/i, "image/jpeg"],
	[/\.webp$/i, "image/webp"],
	[/\.gif$/i, "image/gif"],
];

export const isPromptImageMimeType = (
	mimeType: string,
): mimeType is PromptImageMimeType => promptImageMimeTypes.has(mimeType);

export const resolvePromptImageMimeTypeFromPath = (
	pathValue: string,
): PromptImageMimeType | undefined =>
	IMAGE_PATH_MIME_ENTRIES.find(([pattern]) => pattern.test(pathValue))?.[1];

export const getPromptImageBlocks = (blocks: ContentBlock[]): ImageContent[] =>
	blocks.filter(
		(block): block is Extract<ContentBlock, { type: "image" }> =>
			block.type === "image",
	);

export const estimateBase64DecodedBytes = (value: string): number => {
	const normalized = value.trim();
	if (normalized.length === 0) {
		return 0;
	}
	const padding = normalized.endsWith("==")
		? 2
		: normalized.endsWith("=")
			? 1
			: 0;
	return Math.floor((normalized.length * 3) / 4) - padding;
};

export const validatePromptImageBlocks = (
	blocks: ImageContent[],
): PromptImageValidationResult => {
	if (blocks.length > PROMPT_IMAGE_MAX_COUNT) {
		return {
			ok: false,
			message: `Prompt supports up to ${PROMPT_IMAGE_MAX_COUNT} images`,
		};
	}

	let totalBytes = 0;
	for (const block of blocks) {
		if (!isPromptImageMimeType(block.mimeType)) {
			return {
				ok: false,
				message: `Unsupported image MIME type: ${block.mimeType}`,
			};
		}

		const byteLength = estimateBase64DecodedBytes(block.data);
		if (byteLength > PROMPT_IMAGE_MAX_BYTES) {
			return {
				ok: false,
				message: `Each image must be ${PROMPT_IMAGE_MAX_BYTES / 1024} KiB or smaller`,
			};
		}

		totalBytes += byteLength;
		if (totalBytes > PROMPT_IMAGE_MAX_TOTAL_BYTES) {
			return {
				ok: false,
				message: `Total image payload must be ${PROMPT_IMAGE_MAX_TOTAL_BYTES / 1024} KiB or smaller`,
			};
		}
	}

	return {
		ok: true,
		imageCount: blocks.length,
		totalBytes,
	};
};
