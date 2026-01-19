import type {
	AudioContent,
	ContentBlock,
	ImageContent,
	ResourceContent,
	ResourceLinkContent,
} from "@/lib/acp";

export const createDefaultContentBlocks = (text: string): ContentBlock[] => [
	{ type: "text", text },
];

const cloneResourceContent = (content: ResourceContent): ResourceContent => ({
	...content,
	resource: { ...content.resource },
});

const cloneImageContent = (content: ImageContent): ImageContent => ({
	...content,
});

const cloneAudioContent = (content: AudioContent): AudioContent => ({
	...content,
});

const cloneResourceLinkContent = (
	content: ResourceLinkContent,
): ResourceLinkContent => ({
	...content,
});

export const cloneContentBlock = (block: ContentBlock): ContentBlock => {
	switch (block.type) {
		case "text":
			return { ...block };
		case "resource":
			return cloneResourceContent(block);
		case "resource_link":
			return cloneResourceLinkContent(block);
		case "image":
			return cloneImageContent(block);
		case "audio":
			return cloneAudioContent(block);
		default:
			return block;
	}
};

export const cloneContentBlocks = (blocks: ContentBlock[]): ContentBlock[] =>
	blocks.map(cloneContentBlock);
