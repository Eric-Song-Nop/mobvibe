import type { ChatSession } from "@/lib/chat-store";

type SessionUsage = ChatSession["usage"];
type SessionCost = NonNullable<SessionUsage>["cost"];

const ISO_4217_LIKE_CURRENCY_CODE = /^[A-Z]{3}$/;
let supportedCurrencyCodes: ReadonlySet<string> | null | undefined;

function getSupportedCurrencyCodes(): ReadonlySet<string> | null {
	if (supportedCurrencyCodes !== undefined) {
		return supportedCurrencyCodes;
	}

	const supportedValuesOf = (
		Intl as typeof Intl & {
			supportedValuesOf?: (key: string) => string[];
		}
	).supportedValuesOf;
	if (typeof supportedValuesOf !== "function") {
		supportedCurrencyCodes = null;
		return supportedCurrencyCodes;
	}

	try {
		supportedCurrencyCodes = new Set(supportedValuesOf("currency"));
	} catch {
		supportedCurrencyCodes = null;
	}

	return supportedCurrencyCodes;
}

function isSupportedCurrencyCode(currency: string): boolean {
	if (!ISO_4217_LIKE_CURRENCY_CODE.test(currency)) {
		return false;
	}

	const codes = getSupportedCurrencyCodes();
	return codes ? codes.has(currency) : true;
}

function formatFiniteNumber(
	value: number,
	locale?: string,
): string | undefined {
	if (!Number.isFinite(value)) {
		return undefined;
	}

	try {
		return new Intl.NumberFormat(locale, {
			maximumFractionDigits: 20,
		}).format(value);
	} catch {
		return String(value);
	}
}

export function getContextLeftPercent(usage: SessionUsage): number | undefined {
	if (!usage) {
		return undefined;
	}

	if (!Number.isFinite(usage.size) || usage.size <= 0) {
		return undefined;
	}

	if (!Number.isFinite(usage.used) || usage.used < 0) {
		return undefined;
	}

	const remaining = usage.size - usage.used;
	const percent = Math.round((remaining / usage.size) * 100);

	return Math.min(100, Math.max(0, percent));
}

export function formatSessionTokenUsage(
	usage: SessionUsage,
	locale?: string,
): string | undefined {
	if (!usage) {
		return undefined;
	}
	if (usage.used < 0 || usage.size <= 0) {
		return undefined;
	}

	const used = formatFiniteNumber(usage.used, locale);
	const size = formatFiniteNumber(usage.size, locale);
	if (used === undefined || size === undefined) {
		return undefined;
	}

	return `${used} / ${size}`;
}

export function formatReportedTokenCount(
	value: number | null | undefined,
	locale?: string,
): string | undefined {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		return undefined;
	}
	return formatFiniteNumber(value, locale);
}

export function formatSessionCost(
	cost: SessionCost,
	locale?: string,
): string | undefined {
	if (!cost || typeof cost.currency !== "string" || cost.amount < 0) {
		return undefined;
	}

	const amount = formatFiniteNumber(cost.amount, locale);
	if (amount === undefined) {
		return undefined;
	}

	const fallback = `${amount} ${cost.currency}`.trimEnd();
	if (!isSupportedCurrencyCode(cost.currency)) {
		return fallback;
	}

	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: cost.currency,
			currencyDisplay: "code",
			maximumFractionDigits: 20,
		}).format(cost.amount);
	} catch {
		return fallback;
	}
}
