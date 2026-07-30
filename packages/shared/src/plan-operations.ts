import { sanitizeAcpMeta } from "./acp-meta.js";
import type {
	Plan,
	PlanEntry,
	PlanEntryPriority,
	PlanEntryStatus,
	PlanRemoved,
	PlanUpdate,
	PlanUpdateContent,
} from "./types/acp.js";

const UTF8_ENCODER = new TextEncoder();

export const ACP_MAX_ACTIVE_PLANS = 16;
export const ACP_PLAN_ID_MAX_BYTES = 128;
export const ACP_PLAN_MAX_ENTRIES = 256;
export const ACP_PLAN_ENTRY_MAX_BYTES = 8 * 1024;
export const ACP_PLAN_ENTRIES_MAX_BYTES = 128 * 1024;
export const ACP_PLAN_MARKDOWN_MAX_BYTES = 256 * 1024;
export const ACP_PLAN_URI_MAX_BYTES = 8 * 1024;
export const ACP_PLAN_UPDATE_MAX_BYTES = 512 * 1024;

export type PlanOperationSessionUpdate =
	| (PlanUpdate & { sessionUpdate: "plan_update" })
	| (PlanRemoved & { sessionUpdate: "plan_removed" });

export type PlanSessionUpdate =
	| (Plan & { sessionUpdate: "plan" })
	| PlanOperationSessionUpdate;

const PLAN_PRIORITIES = new Set<PlanEntryPriority>(["high", "medium", "low"]);
const PLAN_STATUSES = new Set<PlanEntryStatus>([
	"pending",
	"in_progress",
	"completed",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const utf8Bytes = (value: string) => UTF8_ENCODER.encode(value).byteLength;

const withinSerializedLimit = <T>(value: T): T | undefined => {
	try {
		return utf8Bytes(JSON.stringify(value)) <= ACP_PLAN_UPDATE_MAX_BYTES
			? value
			: undefined;
	} catch {
		return undefined;
	}
};

const containsControlCharacters = (value: string) => {
	for (let index = 0; index < value.length; index += 1) {
		const codePoint = value.charCodeAt(index);
		if (codePoint <= 0x1f || codePoint === 0x7f) return true;
	}
	return false;
};

const isPlanId = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value === value.trim() &&
	utf8Bytes(value) <= ACP_PLAN_ID_MAX_BYTES &&
	!containsControlCharacters(value);

const sanitizedMeta = (
	record: Record<string, unknown>,
): { _meta?: Record<string, unknown> | null } => {
	if (!Object.hasOwn(record, "_meta") || record._meta === undefined) return {};
	const result = sanitizeAcpMeta(record._meta);
	return result.ok ? { _meta: result.value } : {};
};

const sanitizePlanEntry = (value: unknown): PlanEntry | undefined => {
	if (!isRecord(value) || typeof value.content !== "string") return undefined;
	if (utf8Bytes(value.content) > ACP_PLAN_ENTRY_MAX_BYTES) return undefined;
	if (
		typeof value.priority !== "string" ||
		!PLAN_PRIORITIES.has(value.priority as PlanEntryPriority)
	) {
		return undefined;
	}
	if (
		typeof value.status !== "string" ||
		!PLAN_STATUSES.has(value.status as PlanEntryStatus)
	) {
		return undefined;
	}
	return {
		content: value.content,
		priority: value.priority as PlanEntryPriority,
		status: value.status as PlanEntryStatus,
		...sanitizedMeta(value),
	};
};

const sanitizePlanEntries = (value: unknown): PlanEntry[] | undefined => {
	if (!Array.isArray(value) || value.length > ACP_PLAN_MAX_ENTRIES) {
		return undefined;
	}
	const entries: PlanEntry[] = [];
	let contentBytes = 0;
	for (const entryValue of value) {
		const entry = sanitizePlanEntry(entryValue);
		if (!entry) return undefined;
		contentBytes += utf8Bytes(entry.content);
		if (contentBytes > ACP_PLAN_ENTRIES_MAX_BYTES) return undefined;
		entries.push(entry);
	}
	return entries;
};

const sanitizePlanContent = (value: unknown): PlanUpdateContent | undefined => {
	if (!isRecord(value) || !isPlanId(value.planId)) return undefined;

	switch (value.type) {
		case "items": {
			const entries = sanitizePlanEntries(value.entries);
			if (!entries) return undefined;
			return {
				type: "items",
				planId: value.planId,
				entries,
				...sanitizedMeta(value),
			};
		}
		case "markdown":
			if (
				typeof value.content !== "string" ||
				utf8Bytes(value.content) > ACP_PLAN_MARKDOWN_MAX_BYTES
			) {
				return undefined;
			}
			return {
				type: "markdown",
				planId: value.planId,
				content: value.content,
				...sanitizedMeta(value),
			};
		case "file":
			if (
				typeof value.uri !== "string" ||
				value.uri.length === 0 ||
				utf8Bytes(value.uri) > ACP_PLAN_URI_MAX_BYTES ||
				containsControlCharacters(value.uri)
			) {
				return undefined;
			}
			return {
				type: "file",
				planId: value.planId,
				uri: value.uri,
				...sanitizedMeta(value),
			};
		default:
			return undefined;
	}
};

/**
 * Normalize the experimental plan-operation update into a bounded, fixed-key
 * representation. The current TypeScript SDK uses `planId`; the Draft RFD's
 * older `id` spelling is intentionally not accepted by the SDK wire decoder.
 */
export function sanitizePlanOperationUpdate(
	value: unknown,
): PlanOperationSessionUpdate | undefined {
	if (!isRecord(value)) return undefined;
	if (value.sessionUpdate === "plan_removed") {
		if (!isPlanId(value.planId)) return undefined;
		return withinSerializedLimit({
			sessionUpdate: "plan_removed",
			planId: value.planId,
			...sanitizedMeta(value),
		});
	}
	if (value.sessionUpdate !== "plan_update") return undefined;
	const plan = sanitizePlanContent(value.plan);
	if (!plan) return undefined;
	return withinSerializedLimit({
		sessionUpdate: "plan_update",
		plan,
		...sanitizedMeta(value),
	});
}

/** Normalize either the stable legacy plan or a bounded plan operation. */
export function sanitizePlanSessionUpdate(
	value: unknown,
): PlanSessionUpdate | undefined {
	if (!isRecord(value)) return undefined;
	if (value.sessionUpdate !== "plan") {
		return sanitizePlanOperationUpdate(value);
	}
	const entries = sanitizePlanEntries(value.entries);
	if (!entries) return undefined;
	return withinSerializedLimit({
		sessionUpdate: "plan",
		entries,
		...sanitizedMeta(value),
	});
}
