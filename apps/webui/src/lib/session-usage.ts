import type { ChatSession } from "@/lib/chat-store";

type SessionUsage = ChatSession["usage"];

export function getContextLeftPercent(usage: SessionUsage): number | undefined {
	if (!usage) {
		return undefined;
	}

	if (!Number.isFinite(usage.size) || usage.size <= 0) {
		return undefined;
	}

	if (!Number.isFinite(usage.used)) {
		return undefined;
	}

	const remaining = usage.size - usage.used;
	const percent = Math.round((remaining / usage.size) * 100);

	return Math.min(100, Math.max(0, percent));
}
