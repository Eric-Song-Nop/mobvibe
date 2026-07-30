const UTF8_ENCODER = new TextEncoder();

export const ACP_META_DEFAULT_LIMITS = Object.freeze({
	maxEnvelopeBytes: 16 * 1024,
	maxDepth: 8,
	maxKeys: 128,
	maxArrayLength: 256,
	maxNodes: 512,
	maxKeyBytes: 256,
	maxStringBytes: 8 * 1024,
});

export const ACP_META_MESSAGE_DEFAULT_LIMITS = Object.freeze({
	maxBytes: 64 * 1024,
	maxEnvelopes: 64,
	maxRejections: 16,
});

export const ACP_META_REJECTION_REASONS = Object.freeze({
	arrayTooLong: "array_too_long",
	cyclicValue: "cyclic_value",
	envelopeTooLarge: "envelope_too_large",
	forbiddenKey: "forbidden_key",
	invalidArray: "invalid_array",
	invalidNumber: "invalid_number",
	invalidObject: "invalid_object",
	invalidProperty: "invalid_property",
	invalidTopLevel: "invalid_top_level",
	keyTooLong: "key_too_long",
	messageBytesExceeded: "message_bytes_exceeded",
	messageEnvelopesExceeded: "message_envelopes_exceeded",
	nodeLimitExceeded: "node_limit_exceeded",
	stringTooLong: "string_too_long",
	tooDeep: "too_deep",
	tooManyKeys: "too_many_keys",
	unsupportedValue: "unsupported_value",
} as const);

export type AcpMetaLimits = {
	maxEnvelopeBytes: number;
	maxDepth: number;
	maxKeys: number;
	maxArrayLength: number;
	maxNodes: number;
	maxKeyBytes: number;
	maxStringBytes: number;
};

export type AcpMetaRejectionReason =
	(typeof ACP_META_REJECTION_REASONS)[keyof typeof ACP_META_REJECTION_REASONS];

export type AcpMetaValue = Record<string, unknown> | null;

export type AcpMetaSanitizeResult =
	| {
			ok: true;
			value: AcpMetaValue;
			sizeBytes: number;
			nodes: number;
			keys: number;
	  }
	| { ok: false; reason: AcpMetaRejectionReason };

export type AcpMetaRejection = {
	envelopeIndex: number;
	reason: AcpMetaRejectionReason;
};

export type AcpMessageMetaSanitizeOptions = {
	metaLimits?: Partial<AcpMetaLimits>;
	maxBytes?: number;
	maxEnvelopes?: number;
	maxRejections?: number;
};

export type AcpMessageMetaSanitizeResult<T> = {
	value: T;
	complete: boolean;
	acceptedEnvelopes: number;
	rejectedEnvelopes: number;
	sizeBytes: number;
	rejections: AcpMetaRejection[];
	rejectionsTruncated: boolean;
};

type JsonCloneState = {
	limits: AcpMetaLimits;
	nodes: number;
	keys: number;
	ancestors: Set<object>;
};

type CloneResult =
	| { ok: true; value: unknown }
	| { ok: false; reason: AcpMetaRejectionReason };

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MESSAGE_TRAVERSAL_SKIP_KEYS = new Set(["rawInput", "rawOutput"]);

const utf8Bytes = (value: string) => UTF8_ENCODER.encode(value).byteLength;

const normalizeLimit = (value: number | undefined, fallback: number) =>
	Number.isSafeInteger(value) && (value ?? -1) >= 0
		? (value as number)
		: fallback;

const resolveMetaLimits = (limits?: Partial<AcpMetaLimits>): AcpMetaLimits => {
	try {
		return {
			maxEnvelopeBytes: normalizeLimit(
				limits?.maxEnvelopeBytes,
				ACP_META_DEFAULT_LIMITS.maxEnvelopeBytes,
			),
			maxDepth: normalizeLimit(
				limits?.maxDepth,
				ACP_META_DEFAULT_LIMITS.maxDepth,
			),
			maxKeys: normalizeLimit(limits?.maxKeys, ACP_META_DEFAULT_LIMITS.maxKeys),
			maxArrayLength: normalizeLimit(
				limits?.maxArrayLength,
				ACP_META_DEFAULT_LIMITS.maxArrayLength,
			),
			maxNodes: normalizeLimit(
				limits?.maxNodes,
				ACP_META_DEFAULT_LIMITS.maxNodes,
			),
			maxKeyBytes: normalizeLimit(
				limits?.maxKeyBytes,
				ACP_META_DEFAULT_LIMITS.maxKeyBytes,
			),
			maxStringBytes: normalizeLimit(
				limits?.maxStringBytes,
				ACP_META_DEFAULT_LIMITS.maxStringBytes,
			),
		};
	} catch {
		return { ...ACP_META_DEFAULT_LIMITS };
	}
};

const enterNode = (
	state: JsonCloneState,
	depth: number,
): CloneResult | null => {
	if (depth > state.limits.maxDepth) {
		return { ok: false, reason: ACP_META_REJECTION_REASONS.tooDeep };
	}
	state.nodes += 1;
	if (state.nodes > state.limits.maxNodes) {
		return {
			ok: false,
			reason: ACP_META_REJECTION_REASONS.nodeLimitExceeded,
		};
	}
	return null;
};

const cloneJsonValue = (
	value: unknown,
	depth: number,
	state: JsonCloneState,
): CloneResult => {
	const nodeError = enterNode(state, depth);
	if (nodeError) return nodeError;

	if (value === null || typeof value === "boolean") {
		return { ok: true, value };
	}
	if (typeof value === "string") {
		if (utf8Bytes(value) > state.limits.maxStringBytes) {
			return { ok: false, reason: ACP_META_REJECTION_REASONS.stringTooLong };
		}
		return { ok: true, value };
	}
	if (typeof value === "number") {
		return Number.isFinite(value)
			? { ok: true, value }
			: { ok: false, reason: ACP_META_REJECTION_REASONS.invalidNumber };
	}
	if (typeof value !== "object") {
		return { ok: false, reason: ACP_META_REJECTION_REASONS.unsupportedValue };
	}

	if (state.ancestors.has(value)) {
		return { ok: false, reason: ACP_META_REJECTION_REASONS.cyclicValue };
	}
	state.ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			if (Object.getPrototypeOf(value) !== Array.prototype) {
				return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidArray };
			}
			if (value.length > state.limits.maxArrayLength) {
				return { ok: false, reason: ACP_META_REJECTION_REASONS.arrayTooLong };
			}
			const ownKeys = Reflect.ownKeys(value);
			const expectedKeys = [
				...Array.from({ length: value.length }, (_, index) => String(index)),
				"length",
			];
			if (
				ownKeys.length !== expectedKeys.length ||
				expectedKeys.some((key) => !ownKeys.includes(key))
			) {
				return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidArray };
			}
			const clone: unknown[] = [];
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					String(index),
				);
				if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
					return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidArray };
				}
				const child = cloneJsonValue(descriptor.value, depth + 1, state);
				if (!child.ok) return child;
				clone.push(child.value);
			}
			return { ok: true, value: clone };
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidObject };
		}
		const ownKeys = Reflect.ownKeys(value);
		if (ownKeys.some((key) => typeof key !== "string")) {
			return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidProperty };
		}
		state.keys += ownKeys.length;
		if (state.keys > state.limits.maxKeys) {
			return { ok: false, reason: ACP_META_REJECTION_REASONS.tooManyKeys };
		}

		const clone = Object.create(null) as Record<string, unknown>;
		for (const key of ownKeys as string[]) {
			if (FORBIDDEN_KEYS.has(key)) {
				return { ok: false, reason: ACP_META_REJECTION_REASONS.forbiddenKey };
			}
			if (utf8Bytes(key) > state.limits.maxKeyBytes) {
				return { ok: false, reason: ACP_META_REJECTION_REASONS.keyTooLong };
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				return {
					ok: false,
					reason: ACP_META_REJECTION_REASONS.invalidProperty,
				};
			}
			const child = cloneJsonValue(descriptor.value, depth + 1, state);
			if (!child.ok) return child;
			clone[key] = child.value;
		}
		return { ok: true, value: clone };
	} catch {
		return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidObject };
	} finally {
		state.ancestors.delete(value);
	}
};

export const sanitizeAcpMeta = (
	value: unknown,
	limits?: Partial<AcpMetaLimits>,
): AcpMetaSanitizeResult => {
	try {
		if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
			return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidTopLevel };
		}
		const state: JsonCloneState = {
			limits: resolveMetaLimits(limits),
			nodes: 0,
			keys: 0,
			ancestors: new Set(),
		};
		const cloned = cloneJsonValue(value, 0, state);
		if (!cloned.ok) return cloned;
		const serialized = JSON.stringify(cloned.value);
		if (serialized === undefined) {
			return { ok: false, reason: ACP_META_REJECTION_REASONS.unsupportedValue };
		}
		const sizeBytes = utf8Bytes(serialized);
		if (sizeBytes > state.limits.maxEnvelopeBytes) {
			return {
				ok: false,
				reason: ACP_META_REJECTION_REASONS.envelopeTooLarge,
			};
		}
		return {
			ok: true,
			value: cloned.value as AcpMetaValue,
			sizeBytes,
			nodes: state.nodes,
			keys: state.keys,
		};
	} catch {
		return { ok: false, reason: ACP_META_REJECTION_REASONS.invalidObject };
	}
};

type MessageState = {
	complete: boolean;
	seenObjects: WeakSet<object>;
	metaLimits?: Partial<AcpMetaLimits>;
	maxBytes: number;
	maxEnvelopes: number;
	maxRejections: number;
	acceptedEnvelopes: number;
	rejectedEnvelopes: number;
	sizeBytes: number;
	seenEnvelopes: number;
	bytesExceeded: boolean;
	rejections: AcpMetaRejection[];
	rejectionsTruncated: boolean;
};

const recordMessageRejection = (
	state: MessageState,
	reason: AcpMetaRejectionReason,
) => {
	state.rejectedEnvelopes += 1;
	if (state.rejections.length < state.maxRejections) {
		state.rejections.push({
			envelopeIndex: Math.max(0, state.seenEnvelopes - 1),
			reason,
		});
	} else {
		state.rejectionsTruncated = true;
	}
};

const sanitizeMessageEnvelope = (
	value: unknown,
	state: MessageState,
): AcpMetaValue | undefined => {
	state.seenEnvelopes += 1;
	if (state.seenEnvelopes > state.maxEnvelopes) {
		recordMessageRejection(
			state,
			ACP_META_REJECTION_REASONS.messageEnvelopesExceeded,
		);
		return undefined;
	}
	if (state.bytesExceeded) {
		recordMessageRejection(
			state,
			ACP_META_REJECTION_REASONS.messageBytesExceeded,
		);
		return undefined;
	}
	const sanitized = sanitizeAcpMeta(value, state.metaLimits);
	if (!sanitized.ok) {
		recordMessageRejection(state, sanitized.reason);
		return undefined;
	}
	if (state.sizeBytes + sanitized.sizeBytes > state.maxBytes) {
		state.bytesExceeded = true;
		recordMessageRejection(
			state,
			ACP_META_REJECTION_REASONS.messageBytesExceeded,
		);
		return undefined;
	}
	state.acceptedEnvelopes += 1;
	state.sizeBytes += sanitized.sizeBytes;
	return sanitized.value;
};

type MessageCloneWork = {
	target: object;
	descriptors: Array<[PropertyKey, PropertyDescriptor]>;
	scanMeta: boolean;
};

type MessageCloneCaches = {
	scanned: WeakMap<object, object>;
	opaque: WeakMap<object, object>;
};

const createIncompleteMessageClone = (
	value: object,
	clones: WeakMap<object, object>,
	state: MessageState,
	isArray = false,
): object => {
	state.complete = false;
	const target: object = isArray ? [] : Object.create(null);
	clones.set(value, target);
	return target;
};

const prepareMessageClone = (
	value: object,
	scanMeta: boolean,
	caches: MessageCloneCaches,
	work: MessageCloneWork[],
	state: MessageState,
): object => {
	const clones = scanMeta ? caches.scanned : caches.opaque;
	const existing = clones.get(value);
	if (existing) {
		state.complete = false;
		return existing;
	}
	if (state.seenObjects.has(value)) {
		state.complete = false;
	} else {
		state.seenObjects.add(value);
	}
	try {
		const isArray = Array.isArray(value);
		const prototype = Object.getPrototypeOf(value);
		if (
			(isArray && prototype !== Array.prototype) ||
			(!isArray && prototype !== Object.prototype && prototype !== null)
		) {
			return createIncompleteMessageClone(value, clones, state, isArray);
		}

		const ownKeys = Reflect.ownKeys(value);
		if (isArray) {
			const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
			const length = lengthDescriptor?.value;
			if (
				!lengthDescriptor ||
				!("value" in lengthDescriptor) ||
				!Number.isSafeInteger(length) ||
				length < 0 ||
				ownKeys.length !== length + 1
			) {
				return createIncompleteMessageClone(value, clones, state, true);
			}
			const keySet = new Set(ownKeys);
			if (!keySet.has("length")) {
				return createIncompleteMessageClone(value, clones, state, true);
			}
			for (let index = 0; index < length; index += 1) {
				if (!keySet.has(String(index))) {
					return createIncompleteMessageClone(value, clones, state, true);
				}
			}
		}

		const descriptors: Array<[PropertyKey, PropertyDescriptor]> = [];
		for (const key of ownKeys) {
			if (typeof key !== "string") {
				state.complete = false;
				continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor) {
				descriptors.push([key, descriptor]);
			} else {
				state.complete = false;
			}
		}
		const target: object = isArray ? [] : Object.create(null);
		clones.set(value, target);
		work.push({ target, descriptors, scanMeta });
		return target;
	} catch {
		// Never let an uninspectable exotic object carry hidden metadata through the
		// boundary. Decoded ACP JSON cannot reach this fallback; callers can use the
		// completion flag to reject malformed non-JSON input as a whole.
		return createIncompleteMessageClone(value, clones, state);
	}
};

const cloneMessageValue = (
	value: unknown,
	scanMeta: boolean,
	caches: MessageCloneCaches,
	work: MessageCloneWork[],
	state: MessageState,
): unknown => {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (Number.isFinite(value)) return value;
		state.complete = false;
		return null;
	}
	if (typeof value !== "object") {
		state.complete = false;
		return null;
	}
	return prepareMessageClone(value, scanMeta, caches, work, state);
};

const cloneMessageWithSanitizedMeta = (
	value: unknown,
	state: MessageState,
): unknown => {
	const caches: MessageCloneCaches = {
		scanned: new WeakMap(),
		opaque: new WeakMap(),
	};
	const work: MessageCloneWork[] = [];
	const root = cloneMessageValue(value, true, caches, work, state);

	for (let cursor = 0; cursor < work.length; cursor += 1) {
		const item = work[cursor];
		if (!item) continue;
		for (const [key, descriptor] of item.descriptors) {
			if (Array.isArray(item.target) && key === "length") {
				try {
					Object.defineProperty(item.target, key, descriptor);
				} catch {
					// A normal decoded JSON array always has a valid length descriptor.
					state.complete = false;
				}
				continue;
			}
			if (!("value" in descriptor)) {
				if (item.scanMeta && key === "_meta") {
					state.seenEnvelopes += 1;
					recordMessageRejection(
						state,
						ACP_META_REJECTION_REASONS.invalidProperty,
					);
					continue;
				}
				// Accessors cannot appear in decoded JSON. Dropping them avoids carrying
				// deferred, uninspected objects across this boundary.
				state.complete = false;
				continue;
			}
			if (item.scanMeta && key === "_meta") {
				if (descriptor.value === undefined) continue;
				if (!descriptor.enumerable) {
					state.seenEnvelopes += 1;
					recordMessageRejection(
						state,
						ACP_META_REJECTION_REASONS.invalidProperty,
					);
					continue;
				}
				const sanitized = sanitizeMessageEnvelope(descriptor.value, state);
				if (sanitized === undefined) continue;
				try {
					Object.defineProperty(item.target, key, {
						...descriptor,
						value: sanitized,
					});
				} catch {
					// A normal decoded ACP object cannot reach this branch.
					state.complete = false;
				}
				continue;
			}
			if (!descriptor.enumerable) {
				state.complete = false;
				continue;
			}

			const childScanMeta =
				item.scanMeta &&
				!(typeof key === "string" && MESSAGE_TRAVERSAL_SKIP_KEYS.has(key));
			const child = cloneMessageValue(
				descriptor.value,
				childScanMeta,
				caches,
				work,
				state,
			);
			try {
				Object.defineProperty(item.target, key, {
					...descriptor,
					value: child,
				});
			} catch {
				// Continue cloning sibling core fields without invoking accessors.
				state.complete = false;
			}
		}
	}
	return root;
};

const createMessageState = (
	options?: AcpMessageMetaSanitizeOptions,
): MessageState => {
	try {
		return {
			complete: true,
			seenObjects: new WeakSet(),
			metaLimits: options?.metaLimits,
			maxBytes: normalizeLimit(
				options?.maxBytes,
				ACP_META_MESSAGE_DEFAULT_LIMITS.maxBytes,
			),
			maxEnvelopes: normalizeLimit(
				options?.maxEnvelopes,
				ACP_META_MESSAGE_DEFAULT_LIMITS.maxEnvelopes,
			),
			maxRejections: normalizeLimit(
				options?.maxRejections,
				ACP_META_MESSAGE_DEFAULT_LIMITS.maxRejections,
			),
			acceptedEnvelopes: 0,
			rejectedEnvelopes: 0,
			sizeBytes: 0,
			seenEnvelopes: 0,
			bytesExceeded: false,
			rejections: [],
			rejectionsTruncated: false,
		};
	} catch {
		return createMessageState();
	}
};

export const sanitizeAcpMessageMeta = <T>(
	value: T,
	options?: AcpMessageMetaSanitizeOptions,
): AcpMessageMetaSanitizeResult<T> => {
	const state = createMessageState(options);
	return {
		value: cloneMessageWithSanitizedMeta(value, state) as T,
		complete: state.complete,
		acceptedEnvelopes: state.acceptedEnvelopes,
		rejectedEnvelopes: state.rejectedEnvelopes,
		sizeBytes: state.sizeBytes,
		rejections: state.rejections,
		rejectionsTruncated: state.rejectionsTruncated,
	};
};
