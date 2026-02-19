import type { ContentBlock } from "@mobvibe/shared";

export const createDefaultContentBlocks = (text: string): ContentBlock[] => [
	{ type: "text", text },
];

export const cloneContentBlock = (block: ContentBlock): ContentBlock => {
	switch (block.type) {
		case "text":
			return { ...block };
		case "resource":
			return { ...block, resource: { ...block.resource } };
		case "resource_link":
			return { ...block };
		case "image":
			return { ...block };
		case "audio":
			return { ...block };
		default:
			return block;
	}
};

export const cloneContentBlocks = (blocks: ContentBlock[]): ContentBlock[] =>
	blocks.map(cloneContentBlock);
