/** Agent-provided token counters from an ACP prompt response. */
export type ReportedTokenUsage = {
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	thoughtTokens?: number;
	cachedReadTokens?: number;
	cachedWriteTokens?: number;
};

export const REPORTED_TOKEN_USAGE_MAX_SERIALIZED_BYTES = 512;
const UTF8_ENCODER = new TextEncoder();

const REQUIRED_FIELDS = ["totalTokens", "inputTokens", "outputTokens"] as const;
const OPTIONAL_FIELDS = [
	"thoughtTokens",
	"cachedReadTokens",
	"cachedWriteTokens",
] as const;

const isTokenCount = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	Number.isSafeInteger(value) &&
	value >= 0;

/**
 * Copy the fixed ACP usage fields into a bounded snapshot. Invalid snapshots
 * are omitted as a whole so partial counters cannot be mistaken for totals.
 */
export function sanitizeReportedTokenUsage(
	value: unknown,
): ReportedTokenUsage | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	try {
		const record = value as Record<string, unknown>;
		for (const field of REQUIRED_FIELDS) {
			if (!isTokenCount(record[field])) return undefined;
		}
		for (const field of OPTIONAL_FIELDS) {
			const fieldValue = record[field];
			if (
				fieldValue !== undefined &&
				fieldValue !== null &&
				!isTokenCount(fieldValue)
			) {
				return undefined;
			}
		}

		const sanitized: ReportedTokenUsage = {
			totalTokens: record.totalTokens as number,
			inputTokens: record.inputTokens as number,
			outputTokens: record.outputTokens as number,
		};
		for (const field of OPTIONAL_FIELDS) {
			const fieldValue = record[field];
			if (typeof fieldValue === "number") sanitized[field] = fieldValue;
		}

		return UTF8_ENCODER.encode(JSON.stringify(sanitized)).byteLength <=
			REPORTED_TOKEN_USAGE_MAX_SERIALIZED_BYTES
			? sanitized
			: undefined;
	} catch {
		return undefined;
	}
}
