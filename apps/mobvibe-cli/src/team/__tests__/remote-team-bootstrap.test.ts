import { describe, expect, test } from "bun:test";
import {
	AppError,
	TEAM_RELAY_BACKEND_ID_MAX_BYTES,
	TEAM_RELAY_MACHINE_ID_MAX_BYTES,
	TEAM_RELAY_OPERATION_ID_MAX_BYTES,
} from "@mobvibe/shared";
import {
	parseRemoteTeamBootstrapRequest,
	parseRemoteTeamBootstrapResult,
	REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES,
	REMOTE_TEAM_BOOTSTRAP_MAX_ADDITIONAL_DIRECTORIES,
	REMOTE_TEAM_BOOTSTRAP_PATH_MAX_BYTES,
	REMOTE_TEAM_BOOTSTRAP_SESSION_ID_MAX_BYTES,
} from "../remote-team-bootstrap.js";
import { buildTeamMcpServerId } from "../team-capability.js";
import type { VerifiedTeamRelayRequest } from "../team-relay-protocol.js";

const sourcePublicKey = Buffer.alloc(32, 7).toString("base64");

const createPayload = (
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	operationId: "bootstrap-operation-1",
	agentTeamId: "11111111-1111-4111-8111-111111111111",
	memberId: "22222222-2222-4222-8222-222222222222",
	serverId:
		"mobvibe-team:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
	backendId: "backend-1",
	cwd: "/workspace/project",
	additionalDirectories: ["/workspace/shared", "/opt/reference"],
	...overrides,
});

const createRequest = (input?: {
	request?: Partial<VerifiedTeamRelayRequest>;
	payload?: unknown;
}): VerifiedTeamRelayRequest => ({
	operationId: "bootstrap-operation-1",
	operation: "member.bootstrap",
	sourceMachineId: "leader-machine",
	sourceRelayKey: {
		version: 1,
		keyId: `x25519:${sourcePublicKey}`,
		publicKey: sourcePublicKey,
	},
	targetMachineId: "worker-machine",
	payload:
		input && Object.hasOwn(input, "payload") ? input.payload : createPayload(),
	...input?.request,
});

const expectInvalid = (request: VerifiedTeamRelayRequest): void => {
	try {
		parseRemoteTeamBootstrapRequest(request);
		throw new Error("Expected bootstrap request validation to fail");
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).detail).toEqual(
			expect.objectContaining({
				code: "REQUEST_VALIDATION_FAILED",
				retryable: false,
				scope: "request",
			}),
		);
	}
};

const expectInvalidResult = (
	result: unknown,
	expected = {
		operationId: "bootstrap-operation-1",
		serverId:
			"mobvibe-team:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
	},
): void => {
	try {
		parseRemoteTeamBootstrapResult(result, expected);
		throw new Error("Expected bootstrap result validation to fail");
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).detail).toEqual(
			expect.objectContaining({
				code: "REQUEST_VALIDATION_FAILED",
				retryable: false,
				scope: "request",
			}),
		);
	}
};

describe("parseRemoteTeamBootstrapRequest", () => {
	test("returns only worker execution inputs plus the verified leader identity", () => {
		const request = createRequest();

		expect(parseRemoteTeamBootstrapRequest(request)).toEqual({
			operationId: "bootstrap-operation-1",
			agentTeamId: "11111111-1111-4111-8111-111111111111",
			memberId: "22222222-2222-4222-8222-222222222222",
			serverId:
				"mobvibe-team:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
			backendId: "backend-1",
			cwd: "/workspace/project",
			additionalDirectories: ["/workspace/shared", "/opt/reference"],
			leaderMachineId: "leader-machine",
		});
	});

	test("accepts bounded POSIX and Windows absolute paths", () => {
		const windowsRequest = createRequest({
			payload: createPayload({
				cwd: "C:\\workspace\\project",
				additionalDirectories: ["D:\\shared", "\\\\server\\share\\reference"],
			}),
		});

		expect(parseRemoteTeamBootstrapRequest(windowsRequest)).toEqual(
			expect.objectContaining({
				cwd: "C:\\workspace\\project",
				additionalDirectories: ["D:\\shared", "\\\\server\\share\\reference"],
			}),
		);
	});

	test("rejects operations other than member.bootstrap", () => {
		expectInvalid(
			createRequest({
				request: { operation: "team.command" },
			}),
		);
	});

	test.each([
		["null", null],
		["array", []],
		["string", "payload"],
		["number", 1],
	])("rejects a non-object payload: %s", (_label, payload) => {
		expectInvalid(createRequest({ payload }));
	});

	test("requires every payload field", () => {
		for (const field of [
			"operationId",
			"agentTeamId",
			"memberId",
			"serverId",
			"backendId",
			"cwd",
			"additionalDirectories",
		]) {
			const payload = createPayload();
			delete payload[field];
			expectInvalid(createRequest({ payload }));
		}
	});

	test.each([
		"role",
		"name",
		"title",
		"prompt",
		"task",
		"mailbox",
		"worktree",
		"machineId",
		"executionMachineId",
		"leaderMachineId",
	])("rejects forbidden or otherwise extra payload field %s", (field) => {
		expectInvalid(
			createRequest({
				payload: createPayload({ [field]: "forged" }),
			}),
		);
	});

	test("rejects forged operation and MCP server bindings", () => {
		expectInvalid(
			createRequest({
				payload: createPayload({ operationId: "other-operation" }),
			}),
		);
		expectInvalid(
			createRequest({
				payload: createPayload({
					serverId:
						"mobvibe-team:11111111-1111-4111-8111-111111111111:attacker",
				}),
			}),
		);
	});

	test("rejects empty, control-bearing, unsafe, and oversized identifiers", () => {
		const invalidRequests = [
			createRequest({
				request: { sourceMachineId: "" },
			}),
			createRequest({
				request: { sourceMachineId: "leader\nmachine" },
			}),
			createRequest({
				request: {
					sourceMachineId: "界".repeat(
						Math.floor(TEAM_RELAY_MACHINE_ID_MAX_BYTES / 3) + 1,
					),
				},
			}),
			createRequest({
				request: { operationId: "bad\u0000operation" },
				payload: createPayload({ operationId: "bad\u0000operation" }),
			}),
			createRequest({
				request: {
					operationId: "🚀".repeat(
						Math.floor(TEAM_RELAY_OPERATION_ID_MAX_BYTES / 4) + 1,
					),
				},
				payload: createPayload({
					operationId: "🚀".repeat(
						Math.floor(TEAM_RELAY_OPERATION_ID_MAX_BYTES / 4) + 1,
					),
				}),
			}),
			createRequest({
				payload: createPayload({ agentTeamId: "" }),
			}),
			createRequest({
				payload: createPayload({ agentTeamId: "team/forged" }),
			}),
			createRequest({
				payload: createPayload({ memberId: "member\nforged" }),
			}),
			createRequest({
				payload: createPayload({
					memberId: "m".repeat(REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES + 1),
				}),
			}),
			createRequest({
				payload: createPayload({ backendId: " \t " }),
			}),
			createRequest({
				payload: createPayload({
					backendId: "界".repeat(
						Math.floor(TEAM_RELAY_BACKEND_ID_MAX_BYTES / 3) + 1,
					),
				}),
			}),
		];

		for (const request of invalidRequests) {
			expectInvalid(request);
		}
	});

	test("measures identifier limits in UTF-8 bytes", () => {
		const operationId = "🚀".repeat(TEAM_RELAY_OPERATION_ID_MAX_BYTES / 4);
		const backendId = `${"界".repeat(
			Math.floor(TEAM_RELAY_BACKEND_ID_MAX_BYTES / 3),
		)}a`;
		const leaderMachineId = "🚀".repeat(TEAM_RELAY_MACHINE_ID_MAX_BYTES / 4);
		const agentTeamId = "t".repeat(REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES);
		const memberId = "m".repeat(REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES);
		const serverId = buildTeamMcpServerId({ agentTeamId, memberId });
		const request = createRequest({
			request: { operationId, sourceMachineId: leaderMachineId },
			payload: createPayload({
				operationId,
				agentTeamId,
				memberId,
				serverId,
				backendId,
			}),
		});

		expect(parseRemoteTeamBootstrapRequest(request)).toEqual(
			expect.objectContaining({
				operationId,
				agentTeamId,
				memberId,
				serverId,
				backendId,
				leaderMachineId,
			}),
		);
	});

	test.each([
		"",
		"workspace/project",
		"/workspace/../private",
		"/workspace/./project",
		"C:\\workspace\\..\\private",
		"/workspace/\u0000project",
	])("rejects invalid or traversal-bearing cwd %p", (cwd) => {
		expectInvalid(
			createRequest({
				payload: createPayload({ cwd }),
			}),
		);
	});

	test("rejects malformed, relative, traversal-bearing, and duplicate additional directories", () => {
		for (const additionalDirectories of [
			"not-an-array",
			[1],
			["relative/shared"],
			["/workspace/../private"],
			["C:\\workspace\\..\\private"],
			["/shared", "/shared"],
		]) {
			expectInvalid(
				createRequest({
					payload: createPayload({ additionalDirectories }),
				}),
			);
		}
	});

	test("enforces additional directory count without changing valid order", () => {
		const atLimit = Array.from(
			{ length: REMOTE_TEAM_BOOTSTRAP_MAX_ADDITIONAL_DIRECTORIES },
			(_, index) => `/shared/${index}`,
		);
		const parsed = parseRemoteTeamBootstrapRequest(
			createRequest({
				payload: createPayload({ additionalDirectories: atLimit }),
			}),
		);
		expect(parsed.additionalDirectories).toEqual(atLimit);

		expectInvalid(
			createRequest({
				payload: createPayload({
					additionalDirectories: [...atLimit, "/shared/overflow"],
				}),
			}),
		);
	});

	test("measures cwd and additional directory limits in UTF-8 bytes", () => {
		const maxPath = `/${"界".repeat(
			Math.floor((REMOTE_TEAM_BOOTSTRAP_PATH_MAX_BYTES - 1) / 3),
		)}${"a".repeat((REMOTE_TEAM_BOOTSTRAP_PATH_MAX_BYTES - 1) % 3)}`;
		expect(new TextEncoder().encode(maxPath).byteLength).toBe(
			REMOTE_TEAM_BOOTSTRAP_PATH_MAX_BYTES,
		);
		const parsed = parseRemoteTeamBootstrapRequest(
			createRequest({
				payload: createPayload({
					cwd: maxPath,
					additionalDirectories: [`${maxPath.slice(0, -2)}abc`],
				}),
			}),
		);
		expect(parsed.cwd).toBe(maxPath);

		for (const payload of [
			createPayload({ cwd: `${maxPath}a` }),
			createPayload({
				additionalDirectories: [`${maxPath}a`],
			}),
		]) {
			expectInvalid(createRequest({ payload }));
		}
	});
});

describe("parseRemoteTeamBootstrapResult", () => {
	const expected = {
		operationId: "bootstrap-operation-1",
		serverId:
			"mobvibe-team:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
	};
	const result = {
		...expected,
		sessionId: "remote-acp-session-1",
	};

	test("returns the exact minimal result when operation and server bindings match", () => {
		expect(parseRemoteTeamBootstrapResult(result, expected)).toEqual(result);
	});

	test.each([
		["null", null],
		["array", []],
		["string", "result"],
		["number", 1],
	])("rejects a non-object result: %s", (_label, candidate) => {
		expectInvalidResult(candidate);
	});

	test("requires exactly operationId, serverId, and sessionId", () => {
		for (const field of ["operationId", "serverId", "sessionId"]) {
			const candidate: Record<string, unknown> = { ...result };
			delete candidate[field];
			expectInvalidResult(candidate);
		}
		expectInvalidResult({ ...result, backendId: "backend-1" });
		expectInvalidResult({ ...result, agentTeamId: "team-1" });
		expectInvalidResult({ ...result, machineId: "worker-machine" });
	});

	test("rejects mismatched operation and MCP server bindings", () => {
		expectInvalidResult({ ...result, operationId: "other-operation" });
		expectInvalidResult({ ...result, serverId: "mobvibe-team:forged" });
	});

	test("rejects empty, control-bearing, and oversized session IDs", () => {
		for (const sessionId of [
			"",
			"   ",
			"remote\nsession",
			"🚀".repeat(
				Math.floor(REMOTE_TEAM_BOOTSTRAP_SESSION_ID_MAX_BYTES / 4) + 1,
			),
		]) {
			expectInvalidResult({ ...result, sessionId });
		}
	});

	test("measures the session ID limit in UTF-8 bytes", () => {
		const sessionId = "🚀".repeat(
			REMOTE_TEAM_BOOTSTRAP_SESSION_ID_MAX_BYTES / 4,
		);
		expect(
			parseRemoteTeamBootstrapResult({ ...result, sessionId }, expected),
		).toEqual({
			...result,
			sessionId,
		});
	});
});
