import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultContentBlocks } from "@/lib/content-block-utils";
import { useUiStore } from "@/lib/ui-store";

describe("useUiStore chat drafts", () => {
	beforeEach(() => {
		useUiStore.setState({ chatDrafts: {} });
		vi.restoreAllMocks();
	});

	it("updates chat drafts without writing to localStorage", () => {
		const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
		const draft = {
			input: "Hello",
			inputContents: createDefaultContentBlocks("Hello"),
		};

		act(() => {
			useUiStore.getState().setChatDraft("session-1", draft);
		});

		expect(useUiStore.getState().chatDrafts["session-1"]).toEqual(draft);
		expect(setItemSpy).not.toHaveBeenCalled();
	});

	it("clears drafts per session", () => {
		act(() => {
			useUiStore.getState().setChatDraft("session-1", {
				input: "Hello",
				inputContents: createDefaultContentBlocks("Hello"),
			});
			useUiStore.getState().setChatDraft("session-2", {
				input: "World",
				inputContents: createDefaultContentBlocks("World"),
			});
		});

		act(() => {
			useUiStore.getState().clearChatDraft("session-1");
		});

		expect(useUiStore.getState().chatDrafts["session-1"]).toBeUndefined();
		expect(useUiStore.getState().chatDrafts["session-2"]).toEqual({
			input: "World",
			inputContents: createDefaultContentBlocks("World"),
		});
	});
});
