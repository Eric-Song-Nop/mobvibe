export type ToolCallMetaHints = {
	name?: string;
	command?: string;
	args?: string[];
};

/**
 * Read Mobvibe's optional display hints without assuming opaque ACP metadata
 * has a particular runtime shape.
 */
export const getToolCallMetaHints = (value: unknown): ToolCallMetaHints => {
	try {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			return {};
		}
		const meta = value as Record<string, unknown>;
		const args = meta.args;
		return {
			name: typeof meta.name === "string" ? meta.name : undefined,
			command: typeof meta.command === "string" ? meta.command : undefined,
			args:
				Array.isArray(args) &&
				args.every((argument) => typeof argument === "string")
					? [...args]
					: undefined,
		};
	} catch {
		return {};
	}
};
