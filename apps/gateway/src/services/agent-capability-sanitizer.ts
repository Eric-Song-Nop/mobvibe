import type {
	AgentAuthenticationCapabilities,
	AgentAuthMethod,
	AgentSessionCapabilities,
} from "@mobvibe/shared";

const MAX_AUTH_METHODS = 32;
const MAX_AUTH_METHOD_ID_BYTES = 128;
const MAX_AUTH_METHOD_NAME_BYTES = 256;
const MAX_AUTH_METHOD_DESCRIPTION_BYTES = 1_024;
const hasC0OrDel = (value: string): boolean =>
	Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
	});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedString = (
	value: unknown,
	maxBytes: number,
	allowEmpty = false,
	requireTrimmed = false,
): value is string =>
	typeof value === "string" &&
	(allowEmpty || value.trim().length > 0) &&
	(!requireTrimmed || value === value.trim()) &&
	!hasC0OrDel(value) &&
	Buffer.byteLength(value, "utf8") <= maxBytes;

const sanitizeAuthMethod = (value: unknown): AgentAuthMethod | undefined => {
	if (!isRecord(value)) return undefined;
	// Stable Agent-managed methods have no `type`. Typed env_var/terminal
	// variants are draft protocol surface and must not be advertised.
	if (Object.hasOwn(value, "type")) return undefined;
	if (!isBoundedString(value.id, MAX_AUTH_METHOD_ID_BYTES, false, true)) {
		return undefined;
	}
	if (!isBoundedString(value.name, MAX_AUTH_METHOD_NAME_BYTES))
		return undefined;
	if (
		value.description !== undefined &&
		value.description !== null &&
		!isBoundedString(value.description, MAX_AUTH_METHOD_DESCRIPTION_BYTES, true)
	) {
		return undefined;
	}
	return {
		id: value.id,
		name: value.name,
		...(value.description !== undefined
			? { description: value.description as string | null }
			: {}),
	};
};

export const sanitizeAgentAuthenticationCapabilities = (
	value: unknown,
): AgentAuthenticationCapabilities | undefined => {
	if (!isRecord(value) || !Array.isArray(value.methods)) return undefined;
	const methods: AgentAuthMethod[] = [];
	const seenMethodIds = new Set<string>();
	for (const candidate of value.methods) {
		if (methods.length >= MAX_AUTH_METHODS) break;
		const method = sanitizeAuthMethod(candidate);
		if (!method || seenMethodIds.has(method.id)) continue;
		seenMethodIds.add(method.id);
		methods.push(method);
	}
	return {
		methods,
		logout: value.logout === true,
	};
};

const copyOptionalBoolean = (
	target: Record<string, unknown>,
	source: Record<string, unknown>,
	key: string,
) => {
	if (typeof source[key] === "boolean") target[key] = source[key];
};

/**
 * Copies only known, bounded capability fields from an untrusted CLI response.
 * In particular, unstable auth method variants and their secret-bearing fields
 * can never cross the Gateway boundary.
 */
export const sanitizeAgentSessionCapabilities = (
	value: unknown,
): AgentSessionCapabilities => {
	const source = isRecord(value) ? value : {};
	const result: Record<string, unknown> = {
		list: source.list === true,
		load: source.load === true,
	};
	for (const key of ["resume", "close", "delete", "additionalDirectories"]) {
		copyOptionalBoolean(result, source, key);
	}
	if (isRecord(source.prompt)) {
		const prompt: Record<string, unknown> = {};
		for (const key of ["image", "audio", "embeddedContext"]) {
			copyOptionalBoolean(prompt, source.prompt, key);
		}
		result.prompt = prompt;
	}
	if (isRecord(source.mcp)) {
		const mcp: Record<string, unknown> = {};
		for (const key of ["acp", "stdio", "perSessionBridge"]) {
			copyOptionalBoolean(mcp, source.mcp, key);
		}
		result.mcp = mcp;
	}
	const auth = sanitizeAgentAuthenticationCapabilities(source.auth);
	if (auth) result.auth = auth;
	return result as AgentSessionCapabilities;
};
