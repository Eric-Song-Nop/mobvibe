import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ChatSession } from "@/lib/chat-store";
import { buildSessionTitle, formatRelativeTime } from "../ui-utils";

describe("ui-utils", () => {
	describe("buildSessionTitle", () => {
		it("should return title with session count + 1", () => {
			const sessions: ChatSession[] = [
				{ sessionId: "1" } as ChatSession,
				{ sessionId: "2" } as ChatSession,
			];

			expect(buildSessionTitle(sessions, i18n.t)).toBe(
				i18n.t("session.newTitle", { count: 3 }),
			);
		});

		it("should return title for empty sessions array", () => {
			const sessions: ChatSession[] = [];
			expect(buildSessionTitle(sessions, i18n.t)).toBe(
				i18n.t("session.newTitle", { count: 1 }),
			);
		});

		it("should return title for single session", () => {
			const sessions: ChatSession[] = [{ sessionId: "1" } as ChatSession];

			expect(buildSessionTitle(sessions, i18n.t)).toBe(
				i18n.t("session.newTitle", { count: 2 }),
			);
		});

		it("should handle large session counts", () => {
			const sessions: ChatSession[] = Array.from({ length: 100 }, (_, i) => ({
				sessionId: String(i),
			})) as ChatSession[];

			expect(buildSessionTitle(sessions, i18n.t)).toBe(
				i18n.t("session.newTitle", { count: 101 }),
			);
		});
	});

	describe("formatRelativeTime", () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("uses the provided just-now label for sub-minute differences", () => {
			expect(
				formatRelativeTime("2024-01-01T11:59:45Z", {
					locale: "en",
					justNow: "just now",
				}),
			).toBe("just now");
		});

		it("formats relative time with the requested locale", () => {
			expect(
				formatRelativeTime("2024-01-01T11:58:00Z", {
					locale: "en",
					justNow: "just now",
				}),
			).toBe("2 minutes ago");

			expect(
				formatRelativeTime("2024-01-01T14:00:00Z", {
					locale: "zh-CN",
					justNow: "刚刚",
				}),
			).toBe("2小时后");
		});
	});
});
