import type { ChatSession } from "@mobvibe/core";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { buildSessionTitle, getStatusVariant } from "../ui-utils";

describe("ui-utils", () => {
	describe("getStatusVariant", () => {
		it("should return 'default' for 'ready' state", () => {
			expect(getStatusVariant("ready")).toBe("default");
		});

		it("should return 'destructive' for 'error' state", () => {
			expect(getStatusVariant("error")).toBe("destructive");
		});

		it("should return 'secondary' for 'connecting' state", () => {
			expect(getStatusVariant("connecting")).toBe("secondary");
		});

		it("should return 'outline' for 'stopped' state", () => {
			expect(getStatusVariant("stopped")).toBe("outline");
		});

		it("should return 'outline' for 'idle' state", () => {
			expect(getStatusVariant("idle")).toBe("outline");
		});

		it("should return 'outline' for unknown states", () => {
			expect(getStatusVariant("unknown")).toBe("outline");
			expect(getStatusVariant("")).toBe("outline");
			expect(getStatusVariant(undefined)).toBe("outline");
		});

		it("should handle all valid session states", () => {
			const states = ["idle", "connecting", "ready", "error", "stopped"];

			states.forEach((state) => {
				const variant = getStatusVariant(state);
				expect(
					["default", "destructive", "secondary", "outline"].includes(variant),
				).toBe(true);
			});
		});
	});

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
