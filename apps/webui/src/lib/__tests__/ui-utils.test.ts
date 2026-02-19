import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import type { ChatSession } from "@/lib/chat-store";
import { buildSessionTitle } from "../ui-utils";

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
});
