import type { ContentBlock } from "@mobvibe/shared";

export const createDefaultContentBlocks = (text: string): ContentBlock[] => [
	{ type: "text", text },
];
