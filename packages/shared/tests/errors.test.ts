import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { isProtocolMismatch } from "../src/types/errors.js";

describe("isProtocolMismatch", () => {
	it("does not treat ACP resource-not-found errors as protocol mismatches", () => {
		const error = RequestError.resourceNotFound(
			"file:///workspace/protocol-notes.md",
		);

		expect(error.code).toBe(-32002);
		expect(isProtocolMismatch(error)).toBe(false);
	});

	it("keeps detecting protocol version mismatch messages", () => {
		expect(isProtocolMismatch(new Error("ACP protocol version mismatch"))).toBe(
			true,
		);
		expect(
			isProtocolMismatch(new Error("Unsupported protocol version 2")),
		).toBe(true);
	});
});
