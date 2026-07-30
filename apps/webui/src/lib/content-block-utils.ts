import type { ContentBlock } from "@mobvibe/shared";

export const createDefaultContentBlocks = (text: string): ContentBlock[] => [
	{ type: "text", text },
];

export const normalizeContentBlock = (
	chunk: ContentBlock | string,
): ContentBlock =>
	typeof chunk === "string" ? { type: "text", text: chunk } : chunk;

export const hasSameTextBlockMetadata = (
	left: Extract<ContentBlock, { type: "text" }>,
	right: Extract<ContentBlock, { type: "text" }>,
): boolean => {
	const { text: _leftText, ...leftMetadata } = left;
	const { text: _rightText, ...rightMetadata } = right;
	try {
		return JSON.stringify(leftMetadata) === JSON.stringify(rightMetadata);
	} catch {
		return false;
	}
};

/** Append a streamed block without losing metadata or meaningful media repeats. */
export const appendContentBlock = (
	blocks: readonly ContentBlock[],
	chunk: ContentBlock | string,
): ContentBlock[] => {
	const block = normalizeContentBlock(chunk);
	const previous = blocks.at(-1);
	if (
		block.type === "text" &&
		previous?.type === "text" &&
		hasSameTextBlockMetadata(previous, block)
	) {
		return [
			...blocks.slice(0, -1),
			{ ...previous, text: `${previous.text}${block.text}` },
		];
	}
	return [...blocks, block];
};

export const getContentBlocksText = (blocks: readonly ContentBlock[]): string =>
	blocks
		.filter(
			(block): block is Extract<ContentBlock, { type: "text" }> =>
				block.type === "text",
		)
		.map((block) => block.text)
		.join("");
