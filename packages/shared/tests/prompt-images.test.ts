import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	estimateBase64DecodedBytes,
	getPromptImageBlocks,
	isPromptImageMimeType,
	PROMPT_IMAGE_MAX_BYTES,
	PROMPT_IMAGE_MAX_COUNT,
	PROMPT_IMAGE_MAX_TOTAL_BYTES,
	resolvePromptImageMimeTypeFromPath,
	validatePromptImageBlocks,
} from "../src/prompt-images.js";
import type { ContentBlock } from "../src/types/acp.js";

const createBase64OfSize = (size: number) =>
	Buffer.alloc(size, 1).toString("base64");

const createImageBlock = (
	size: number,
	overrides: Partial<Extract<ContentBlock, { type: "image" }>> = {},
): Extract<ContentBlock, { type: "image" }> => ({
	type: "image",
	data: createBase64OfSize(size),
	mimeType: "image/png",
	uri: null,
	...overrides,
});

describe("prompt-images", () => {
	it("recognizes supported prompt image MIME types", () => {
		expect(isPromptImageMimeType("image/png")).toBe(true);
		expect(isPromptImageMimeType("image/jpeg")).toBe(true);
		expect(isPromptImageMimeType("image/svg+xml")).toBe(false);
		expect(isPromptImageMimeType("")).toBe(false);
	});

	it("resolves MIME types from supported file paths", () => {
		expect(resolvePromptImageMimeTypeFromPath("/tmp/demo.PNG")).toBe(
			"image/png",
		);
		expect(resolvePromptImageMimeTypeFromPath("photo.jpeg")).toBe("image/jpeg");
		expect(resolvePromptImageMimeTypeFromPath("image.webp")).toBe("image/webp");
		expect(resolvePromptImageMimeTypeFromPath("anim.GIF")).toBe("image/gif");
		expect(resolvePromptImageMimeTypeFromPath("notes.txt")).toBeUndefined();
	});

	it("estimates decoded byte sizes from base64 payloads", () => {
		expect(estimateBase64DecodedBytes("")).toBe(0);
		expect(estimateBase64DecodedBytes(" YQ== ")).toBe(1);
		expect(estimateBase64DecodedBytes("YWJj")).toBe(3);
		expect(estimateBase64DecodedBytes("YWJjZA==")).toBe(4);
	});

	it("filters image content blocks from mixed prompt content", () => {
		const blocks: ContentBlock[] = [
			{ type: "text", text: "hello" },
			{
				type: "image",
				data: "dGVzdA==",
				mimeType: "image/png",
				uri: null,
			},
			{
				type: "resource_link",
				uri: "file:///repo/README.md",
				name: "README.md",
			},
			{
				type: "image",
				data: "bW9yZQ==",
				mimeType: "image/webp",
				uri: null,
			},
		];

		expect(getPromptImageBlocks(blocks)).toEqual([
			{
				type: "image",
				data: "dGVzdA==",
				mimeType: "image/png",
				uri: null,
			},
			{
				type: "image",
				data: "bW9yZQ==",
				mimeType: "image/webp",
				uri: null,
			},
		]);
	});

	it("validates supported image blocks within the configured limits", () => {
		const blocks = [
			createImageBlock(128),
			createImageBlock(256, { mimeType: "image/jpeg" }),
		];

		expect(validatePromptImageBlocks(blocks)).toEqual({
			ok: true,
			imageCount: 2,
			totalBytes: 384,
		});
	});

	it("rejects unsupported image MIME types", () => {
		expect(
			validatePromptImageBlocks([
				createImageBlock(32, { mimeType: "image/svg+xml" }),
			]),
		).toEqual({
			ok: false,
			message: "Unsupported image MIME type: image/svg+xml",
		});
	});

	it("rejects images that exceed the per-image byte limit", () => {
		expect(
			validatePromptImageBlocks([createImageBlock(PROMPT_IMAGE_MAX_BYTES + 1)]),
		).toEqual({
			ok: false,
			message: `Each image must be ${PROMPT_IMAGE_MAX_BYTES / 1024} KiB or smaller`,
		});
	});

	it("rejects prompts that exceed the max image count", () => {
		expect(
			validatePromptImageBlocks(
				Array.from({ length: PROMPT_IMAGE_MAX_COUNT + 1 }, () =>
					createImageBlock(32),
				),
			),
		).toEqual({
			ok: false,
			message: `Prompt supports up to ${PROMPT_IMAGE_MAX_COUNT} images`,
		});
	});

	it("keeps the total byte limit aligned with the current per-image limits", () => {
		expect(PROMPT_IMAGE_MAX_TOTAL_BYTES).toBe(
			PROMPT_IMAGE_MAX_COUNT * PROMPT_IMAGE_MAX_BYTES,
		);

		const result = validatePromptImageBlocks(
			Array.from({ length: PROMPT_IMAGE_MAX_COUNT }, () =>
				createImageBlock(PROMPT_IMAGE_MAX_BYTES),
			),
		);

		expect(result).toEqual({
			ok: true,
			imageCount: PROMPT_IMAGE_MAX_COUNT,
			totalBytes: PROMPT_IMAGE_MAX_TOTAL_BYTES,
		});
	});
});
