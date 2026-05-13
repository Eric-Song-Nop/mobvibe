import { describe, expect, test } from "bun:test";
import { AppError } from "@mobvibe/shared";
import {
	buildTeamMcpDeclaration,
	buildTeamMcpServerId,
	buildTeamMcpSessionSelection,
	resolveTeamMcpTransport,
	type TeamMcpIdentityInput,
} from "../team-capability.js";

describe("team MCP capability resolution", () => {
	test("builds native ACP declaration with component-owned server id", () => {
		const declaration = buildTeamMcpDeclaration({
			agentTeamId: "team-123",
			memberId: "member-456",
		});

		expect(declaration).toEqual({
			type: "acp",
			name: "mobvibe-team",
			id: "mobvibe-team:team-123:member-456",
		});
	});

	test("resolves native ACP transport before bridge fallback", () => {
		expect(
			resolveTeamMcpTransport({
				list: true,
				load: true,
				mcp: { acp: true, stdio: true, perSessionBridge: true },
			}),
		).toBe("acp");
	});

	test("rejects stdio bridge fallback until an executable bridge server exists", () => {
		expect(() =>
			resolveTeamMcpTransport({
				list: true,
				load: true,
				mcp: { stdio: true, perSessionBridge: true },
			}),
		).toThrow(AppError);

		try {
			buildTeamMcpSessionSelection({
				capabilities: {
					list: true,
					load: true,
					mcp: { stdio: true, perSessionBridge: true },
				},
				agentTeamId: "team-1",
				memberId: "member-1",
			});
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			if (error instanceof AppError) {
				expect(error.status).toBe(409);
				expect(error.detail).toMatchObject({
					code: "CAPABILITY_NOT_SUPPORTED",
					retryable: false,
					scope: "session",
				});
				expect(error.detail.message).toContain(
					"stdio bridge fallback is not executable yet",
				);
			}
		}
	});

	test("rejects unsupported autonomous team backends with ErrorDetail semantics", () => {
		expect(() =>
			resolveTeamMcpTransport({
				list: true,
				load: true,
				mcp: { stdio: true },
			}),
		).toThrow(AppError);

		try {
			resolveTeamMcpTransport({ list: true, load: true });
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			if (error instanceof AppError) {
				expect(error.status).toBe(409);
				expect(error.detail).toMatchObject({
					code: "CAPABILITY_NOT_SUPPORTED",
					scope: "session",
					retryable: false,
				});
			}
		}
	});

	test("rejects malformed team and member ids before declaration construction", () => {
		expect(() =>
			buildTeamMcpServerId({ agentTeamId: "team:bad", memberId: "member-1" }),
		).toThrow(AppError);
		expect(() =>
			buildTeamMcpDeclaration({ agentTeamId: "team-1", memberId: "" }),
		).toThrow(AppError);
	});

	test("does not accept fromMemberId as caller identity input", () => {
		const spoofedInput = {
			agentTeamId: "team-1",
			memberId: "member-real",
			fromMemberId: "member-spoofed",
		} as unknown as TeamMcpIdentityInput;

		expect(buildTeamMcpServerId(spoofedInput)).toBe(
			"mobvibe-team:team-1:member-real",
		);
	});
});
