import { describe, expect, it } from "vitest";
import { sanitizeAgentSessionCapabilities } from "../agent-capability-sanitizer.js";

describe("sanitizeAgentSessionCapabilities", () => {
	it("maps only the ACP 1.2.1 MCP transport capabilities", () => {
		const result = sanitizeAgentSessionCapabilities({
			list: true,
			load: true,
			mcp: {
				acp: true,
				http: true,
				sse: false,
				stdio: true,
				perSessionBridge: true,
				unknownTransport: true,
			},
		});

		expect(result).toEqual({
			list: true,
			load: true,
			mcp: {
				acp: true,
				http: true,
				sse: false,
			},
		});
	});
});
