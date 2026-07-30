import { describe, expect, it } from "vitest";
import {
	ACP_META_DEFAULT_LIMITS,
	ACP_META_MESSAGE_DEFAULT_LIMITS,
	ACP_META_REJECTION_REASONS,
	sanitizeAcpMessageMeta,
	sanitizeAcpMeta,
} from "../src/acp-meta.js";

const expectRejected = (
	value: unknown,
	reason: string,
	limits?: Parameters<typeof sanitizeAcpMeta>[1],
) => {
	const result = sanitizeAcpMeta(value, limits);
	expect(result).toEqual({ ok: false, reason });
};

describe("sanitizeAcpMeta", () => {
	it("accepts null and returns detached null-prototype JSON clones", () => {
		expect(sanitizeAcpMeta(null)).toEqual({
			ok: true,
			value: null,
			sizeBytes: 4,
			nodes: 1,
			keys: 0,
		});

		const nested = Object.assign(Object.create(null), { enabled: true });
		const input = { text: "safe", nested, list: [1, null, "three"] };
		const result = sanitizeAcpMeta(input);

		expect(result.ok).toBe(true);
		if (!result.ok || result.value === null) return;
		expect(result.value).toEqual(input);
		expect(result.value).not.toBe(input);
		expect(Object.getPrototypeOf(result.value)).toBeNull();
		const clonedNested = result.value.nested as Record<string, unknown>;
		expect(clonedNested).not.toBe(nested);
		expect(Object.getPrototypeOf(clonedNested)).toBeNull();
		expect(input).toEqual({
			text: "safe",
			nested: { enabled: true },
			list: [1, null, "three"],
		});
	});

	it("requires a plain or null-prototype top-level object", () => {
		expectRejected([], ACP_META_REJECTION_REASONS.invalidTopLevel);
		expectRejected("meta", ACP_META_REJECTION_REASONS.invalidTopLevel);
		expectRejected(1, ACP_META_REJECTION_REASONS.invalidTopLevel);
		expectRejected(new Date(), ACP_META_REJECTION_REASONS.invalidObject);
	});

	it("exposes immutable default security limits", () => {
		expect(Object.isFrozen(ACP_META_DEFAULT_LIMITS)).toBe(true);
		expect(Object.isFrozen(ACP_META_MESSAGE_DEFAULT_LIMITS)).toBe(true);
	});

	it("rejects non-JSON values and non-finite numbers at any depth", () => {
		for (const value of [undefined, 1n, Symbol("meta"), () => undefined]) {
			expectRejected(
				{ nested: { value } },
				ACP_META_REJECTION_REASONS.unsupportedValue,
			);
		}
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
			expectRejected(
				{ nested: [value] },
				ACP_META_REJECTION_REASONS.invalidNumber,
			);
		}
	});

	it("rejects cycles, sparse arrays, symbols, accessors, and exotic nested objects", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expectRejected(cyclic, ACP_META_REJECTION_REASONS.cyclicValue);

		const sparse: unknown[] = [];
		sparse.length = 2;
		expectRejected({ sparse }, ACP_META_REJECTION_REASONS.invalidArray);

		const customIndex: unknown[] = [];
		Object.defineProperty(customIndex, "4294967295", {
			value: "hidden by JSON.stringify",
			enumerable: true,
		});
		expectRejected({ customIndex }, ACP_META_REJECTION_REASONS.invalidArray);

		const customPrototype: unknown[] = [];
		Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
		expectRejected(
			{ customPrototype },
			ACP_META_REJECTION_REASONS.invalidArray,
		);

		const withSymbol = { safe: true } as Record<PropertyKey, unknown>;
		withSymbol[Symbol("hidden")] = true;
		expectRejected(withSymbol, ACP_META_REJECTION_REASONS.invalidProperty);

		let getterCalled = false;
		const withGetter: Record<string, unknown> = {};
		Object.defineProperty(withGetter, "secret", {
			enumerable: true,
			get() {
				getterCalled = true;
				return "secret";
			},
		});
		expectRejected(withGetter, ACP_META_REJECTION_REASONS.invalidProperty);
		expect(getterCalled).toBe(false);

		expectRejected(
			{ nested: new Map([["a", 1]]) },
			ACP_META_REJECTION_REASONS.invalidObject,
		);
	});

	it("rejects prototype-pollution keys at any object depth", () => {
		for (const key of ["__proto__", "prototype", "constructor"]) {
			const input = JSON.parse(`{"outer":{"${key}":{"polluted":true}}}`);
			expectRejected(input, ACP_META_REJECTION_REASONS.forbiddenKey);
		}
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
	});

	it("enforces UTF-8 key and string byte limits", () => {
		const keyAtLimit = "é".repeat(ACP_META_DEFAULT_LIMITS.maxKeyBytes / 2);
		expect(sanitizeAcpMeta({ [keyAtLimit]: true }).ok).toBe(true);
		expectRejected(
			{ [`${keyAtLimit}é`]: true },
			ACP_META_REJECTION_REASONS.keyTooLong,
		);

		const stringAtLimit = "x".repeat(ACP_META_DEFAULT_LIMITS.maxStringBytes);
		expect(sanitizeAcpMeta({ value: stringAtLimit }).ok).toBe(true);
		expectRejected(
			{ value: `${stringAtLimit}x` },
			ACP_META_REJECTION_REASONS.stringTooLong,
		);
	});

	it("enforces the serialized envelope byte limit exactly", () => {
		const value = { escaped: "\n".repeat(32), emoji: "😀".repeat(8) };
		const initial = sanitizeAcpMeta(value);
		expect(initial.ok).toBe(true);
		if (!initial.ok) return;

		expect(
			sanitizeAcpMeta(value, { maxEnvelopeBytes: initial.sizeBytes }).ok,
		).toBe(true);
		expectRejected(value, ACP_META_REJECTION_REASONS.envelopeTooLarge, {
			maxEnvelopeBytes: initial.sizeBytes - 1,
		});
	});

	it("enforces depth, cumulative key, array, and node limits", () => {
		const depth = { one: { two: { three: true } } };
		expect(sanitizeAcpMeta(depth, { maxDepth: 3 }).ok).toBe(true);
		expectRejected(depth, ACP_META_REJECTION_REASONS.tooDeep, {
			maxDepth: 2,
		});

		const keysAtLimit = Object.fromEntries(
			Array.from({ length: ACP_META_DEFAULT_LIMITS.maxKeys }, (_, index) => [
				`key-${index}`,
				true,
			]),
		);
		expect(sanitizeAcpMeta(keysAtLimit).ok).toBe(true);
		expectRejected(
			{ ...keysAtLimit, overflow: true },
			ACP_META_REJECTION_REASONS.tooManyKeys,
		);

		const arrayAtLimit = Array.from(
			{ length: ACP_META_DEFAULT_LIMITS.maxArrayLength },
			(_, index) => index,
		);
		expect(sanitizeAcpMeta({ arrayAtLimit }).ok).toBe(true);
		expectRejected(
			{ values: [...arrayAtLimit, 257] },
			ACP_META_REJECTION_REASONS.arrayTooLong,
		);

		const nodesAtLimit = {
			left: Array.from({ length: 254 }, () => null),
			right: Array.from({ length: 255 }, () => null),
		};
		expect(sanitizeAcpMeta(nodesAtLimit).ok).toBe(true);
		expectRejected(
			{
				left: Array.from({ length: 255 }, () => null),
				right: Array.from({ length: 255 }, () => null),
			},
			ACP_META_REJECTION_REASONS.nodeLimitExceeded,
		);
	});

	it("does not throw when reflective operations fail", () => {
		const throwing = new Proxy(
			{},
			{
				ownKeys() {
					throw new Error("blocked");
				},
			},
		);
		expectRejected(throwing, ACP_META_REJECTION_REASONS.invalidObject);

		const revocable = Proxy.revocable({}, {});
		revocable.revoke();
		expect(() => sanitizeAcpMeta(revocable.proxy)).not.toThrow();
		expectRejected(revocable.proxy, ACP_META_REJECTION_REASONS.invalidObject);

		const throwingLimits = new Proxy(
			{},
			{
				get() {
					throw new Error("blocked");
				},
			},
		);
		expect(() => sanitizeAcpMeta({ safe: true }, throwingLimits)).not.toThrow();
		expect(sanitizeAcpMeta({ safe: true }, throwingLimits).ok).toBe(true);
	});
});

describe("sanitizeAcpMessageMeta", () => {
	it("drops only an invalid envelope and preserves the core update", () => {
		const input = {
			sessionId: "session-1",
			_meta: { source: "safe" },
			update: {
				sessionUpdate: "session_info_update",
				title: "Core title",
				_meta: { value: Number.NaN },
			},
		};

		const result = sanitizeAcpMessageMeta(input);

		expect(result.acceptedEnvelopes).toBe(1);
		expect(result.rejectedEnvelopes).toBe(1);
		expect(result.value.update).toEqual({
			sessionUpdate: "session_info_update",
			title: "Core title",
		});
		expect(result.value._meta).toEqual({ source: "safe" });
		expect(input.update).toHaveProperty("_meta");
		expect(Object.getPrototypeOf(result.value._meta)).toBeNull();

		const omitted = sanitizeAcpMessageMeta({ id: "core", _meta: undefined });
		expect(omitted.complete).toBe(true);
		expect(omitted.value).toEqual({ id: "core" });
	});

	it("enforces the 64-envelope aggregate while retaining every core item", () => {
		const input = {
			sessions: Array.from({ length: 65 }, (_, index) => ({
				sessionId: `session-${index}`,
				_meta: { index },
			})),
		};

		const result = sanitizeAcpMessageMeta(input);

		expect(result.acceptedEnvelopes).toBe(64);
		expect(result.rejectedEnvelopes).toBe(1);
		expect(result.value.sessions).toHaveLength(65);
		expect(result.value.sessions[64]?.sessionId).toBe("session-64");
		expect(Object.hasOwn(result.value.sessions[64] ?? {}, "_meta")).toBe(false);
		expect(result.rejections).toEqual([
			{
				envelopeIndex: 64,
				reason: ACP_META_REJECTION_REASONS.messageEnvelopesExceeded,
			},
		]);
	});

	it("enforces the default 64 KiB aggregate limit", () => {
		const envelope = {
			first: "x".repeat(8_000),
			second: "y".repeat(8_000),
		};
		const single = sanitizeAcpMeta(envelope);
		expect(single.ok).toBe(true);
		if (!single.ok) return;
		expect(single.sizeBytes * 4).toBeLessThanOrEqual(
			ACP_META_MESSAGE_DEFAULT_LIMITS.maxBytes,
		);
		expect(single.sizeBytes * 5).toBeGreaterThan(
			ACP_META_MESSAGE_DEFAULT_LIMITS.maxBytes,
		);

		const result = sanitizeAcpMessageMeta(
			Array.from({ length: 5 }, (_, index) => ({ index, _meta: envelope })),
		);

		expect(result.acceptedEnvelopes).toBe(4);
		expect(result.rejectedEnvelopes).toBe(1);
		expect(Object.hasOwn(result.value[4] ?? {}, "_meta")).toBe(false);
	});

	it("drops the current and later envelopes after aggregate bytes overflow", () => {
		const first = sanitizeAcpMeta({ value: "one" });
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const input = [
			{ id: 1, _meta: { value: "one" } },
			{ id: 2, _meta: { value: "two" } },
			{ id: 3, _meta: null },
		];

		const result = sanitizeAcpMessageMeta(input, {
			maxBytes: first.sizeBytes,
		});

		expect(result.acceptedEnvelopes).toBe(1);
		expect(result.rejectedEnvelopes).toBe(2);
		expect(result.value.map((item) => item.id)).toEqual([1, 2, 3]);
		expect(Object.hasOwn(result.value[1] ?? {}, "_meta")).toBe(false);
		expect(Object.hasOwn(result.value[2] ?? {}, "_meta")).toBe(false);
	});

	it("does not reinterpret opaque tool input and output keys as ACP envelopes", () => {
		const input = {
			update: {
				sessionUpdate: "tool_call",
				_meta: { safe: true },
				rawInput: { _meta: { constructor: "tool data" } },
				rawOutput: { _meta: { value: "opaque tool data" } },
			},
		};

		const result = sanitizeAcpMessageMeta(input);

		expect(result.acceptedEnvelopes).toBe(1);
		expect(result.rejectedEnvelopes).toBe(0);
		expect(result.value.update.rawInput).not.toBe(input.update.rawInput);
		expect(result.value.update.rawOutput).not.toBe(input.update.rawOutput);
		expect(result.value.update.rawInput).toEqual(input.update.rawInput);
		expect(result.value.update.rawOutput).toEqual(input.update.rawOutput);
	});

	it("drops an accessor or revoked metadata envelope without touching core fields", () => {
		let getterCalled = false;
		const accessorMessage: Record<string, unknown> = { id: "core" };
		Object.defineProperty(accessorMessage, "_meta", {
			enumerable: true,
			get() {
				getterCalled = true;
				return { unsafe: true };
			},
		});
		const accessorResult = sanitizeAcpMessageMeta(accessorMessage);
		expect(getterCalled).toBe(false);
		expect(accessorResult.value.id).toBe("core");
		expect(Object.hasOwn(accessorResult.value, "_meta")).toBe(false);
		expect(accessorResult.rejections).toEqual([
			{
				envelopeIndex: 0,
				reason: ACP_META_REJECTION_REASONS.invalidProperty,
			},
		]);

		const revocable = Proxy.revocable({}, {});
		revocable.revoke();
		const revokedResult = sanitizeAcpMessageMeta({
			id: "core",
			_meta: revocable.proxy,
		});
		expect(revokedResult.value.id).toBe("core");
		expect(Object.hasOwn(revokedResult.value, "_meta")).toBe(false);
		expect(revokedResult.rejectedEnvelopes).toBe(1);
	});

	it("drops core accessors without invoking them and preserves cycles", () => {
		let getterCalled = false;
		const array: unknown[] = [];
		Object.defineProperty(array, "0", {
			enumerable: true,
			configurable: true,
			get() {
				getterCalled = true;
				return "core";
			},
		});
		array.length = 1;
		const arrayResult = sanitizeAcpMessageMeta({ array });
		expect(getterCalled).toBe(false);
		expect(arrayResult.complete).toBe(false);
		expect(Object.hasOwn(arrayResult.value.array, "0")).toBe(false);

		const cyclic: { id: string; self?: unknown } = { id: "cycle" };
		cyclic.self = cyclic;
		const cycleResult = sanitizeAcpMessageMeta(cyclic);
		expect(cycleResult.complete).toBe(false);
		expect(cycleResult.value).not.toBe(cyclic);
		expect(cycleResult.value.self).toBe(cycleResult.value);
	});

	it("handles deeply nested core messages and throwing options without throwing", () => {
		const root: Record<string, unknown> = {};
		let cursor = root;
		for (let depth = 0; depth < 15_000; depth += 1) {
			const next: Record<string, unknown> = {};
			cursor.next = next;
			cursor = next;
		}
		cursor._meta = { safe: true };
		expect(() => sanitizeAcpMessageMeta(root)).not.toThrow();
		const deepResult = sanitizeAcpMessageMeta(root);
		expect(deepResult.acceptedEnvelopes).toBe(1);

		const throwingOptions = new Proxy(
			{},
			{
				get() {
					throw new Error("blocked");
				},
			},
		);
		expect(() =>
			sanitizeAcpMessageMeta({ id: "core" }, throwingOptions),
		).not.toThrow();
	});

	it("fails closed without returning an uninspectable core object", () => {
		const target = {
			id: "hidden-core",
			_meta: JSON.parse('{"constructor":"must be rejected"}'),
		};
		const throwing = new Proxy(target, {
			ownKeys() {
				throw new Error("blocked");
			},
		});
		const sourceObjects = new WeakSet<object>([throwing]);

		const result = sanitizeAcpMessageMeta(throwing);

		expect(result.complete).toBe(false);
		expect(sourceObjects.has(result.value)).toBe(false);
		expect(Object.getPrototypeOf(result.value)).toBeNull();
		expect(Object.hasOwn(result.value, "_meta")).toBe(false);
	});

	it("keeps opaque and scanned aliases in separate clone contexts", () => {
		const shared = {
			payload: "core",
			_meta: JSON.parse('{"constructor":"opaque tool data"}'),
		};
		const result = sanitizeAcpMessageMeta({
			rawInput: shared,
			normal: shared,
		});

		expect(result.complete).toBe(false);
		expect(result.value.rawInput).not.toBe(result.value.normal);
		expect(result.value.rawInput).toEqual(shared);
		expect(result.value.normal).toEqual({ payload: "core" });
		expect(result.rejectedEnvelopes).toBe(1);
	});

	it("marks non-JSON core values incomplete without returning hidden metadata", () => {
		const callable = Object.assign(() => undefined, {
			_meta: JSON.parse('{"constructor":"hidden on function"}'),
		});
		const date = new Date("2026-01-01T00:00:00.000Z");
		const result = sanitizeAcpMessageMeta({
			id: "safe-core",
			callable,
			date,
			notFinite: Number.POSITIVE_INFINITY,
			bigint: 1n,
			missing: undefined,
		});

		expect(result.complete).toBe(false);
		expect(result.value.id).toBe("safe-core");
		expect(result.value.callable).toBeNull();
		expect(Object.getPrototypeOf(result.value.date)).toBeNull();
		expect(Object.hasOwn(result.value.date, "_meta")).toBe(false);
		expect(result.value.notFinite).toBeNull();
		expect(result.value.bigint).toBeNull();
		expect(result.value.missing).toBeNull();
	});

	it("bounds rejection details without dropping additional core messages", () => {
		const input = Array.from({ length: 5 }, (_, index) => ({
			id: index,
			_meta: [],
		}));
		const result = sanitizeAcpMessageMeta(input, { maxRejections: 2 });

		expect(result.value.map((item) => item.id)).toEqual([0, 1, 2, 3, 4]);
		expect(result.rejectedEnvelopes).toBe(5);
		expect(result.rejections).toHaveLength(2);
		expect(result.rejectionsTruncated).toBe(true);
	});
});
