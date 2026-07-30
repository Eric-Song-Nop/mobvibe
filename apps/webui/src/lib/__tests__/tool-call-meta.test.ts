import { describe, expect, it } from "vitest";
import { getToolCallMetaHints } from "../tool-call-meta";

describe("getToolCallMetaHints", () => {
	it("returns cloned hints only when every field has the expected runtime type", () => {
		const metadata = Object.assign(
			Object.create(null) as Record<string, unknown>,
			{
				name: "shell",
				command: "git",
				args: ["status", "--short"],
			},
		);

		const hints = getToolCallMetaHints(metadata);

		expect(hints).toEqual({
			name: "shell",
			command: "git",
			args: ["status", "--short"],
		});
		expect(hints.args).not.toBe(metadata.args);
	});

	it("ignores malformed hints without invoking attacker-controlled methods", () => {
		const join = () => {
			throw new Error("must not be called");
		};

		expect(
			getToolCallMetaHints({
				name: 42,
				command: { value: "rm" },
				args: { join },
			}),
		).toEqual({ name: undefined, command: undefined, args: undefined });
	});

	it("fails closed when metadata property access throws", () => {
		const metadata = new Proxy(
			{},
			{
				get() {
					throw new Error("blocked");
				},
			},
		);

		expect(getToolCallMetaHints(metadata)).toEqual({});
	});
});
