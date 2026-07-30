import { describe, expect, mock, test } from "bun:test";
import { AppError } from "@mobvibe/shared";
import type { AgentTeamMemberExecution } from "../agent-team-store.js";
import type { VerifiedTeamRelayRequest } from "../team-relay-protocol.js";
import {
	createLeaderTeamRuntimeRelayHandler,
	parseTeamRuntimeRelayPayload,
	TEAM_RUNTIME_RELAY_VERSION,
} from "../team-runtime-relay.js";

const publicKey = Buffer.alloc(32, 13).toString("base64");
const workerRelayKey = {
	version: 1 as const,
	keyId: `x25519:${publicKey}`,
	publicKey,
};

const payload = {
	version: TEAM_RUNTIME_RELAY_VERSION,
	type: "turn_completed" as const,
	operationId: "runtime-operation-1",
	agentTeamId: "team-1",
	memberId: "member-1",
	turnId: "turn-1",
};

const route = {
	agentTeamId: payload.agentTeamId,
	memberId: payload.memberId,
	executionMachineId: "worker-machine",
	workerRelayKeyId: workerRelayKey.keyId,
	bootstrapOperationId: "bootstrap-operation-1",
	createdAt: "2026-07-30T00:00:00.000Z",
	updatedAt: "2026-07-30T00:00:00.000Z",
} satisfies AgentTeamMemberExecution;

const createRequest = (
	overrides: Partial<VerifiedTeamRelayRequest> = {},
): VerifiedTeamRelayRequest => ({
	operationId: payload.operationId,
	operation: "member.runtime",
	sourceMachineId: route.executionMachineId,
	sourceRelayKey: workerRelayKey,
	targetMachineId: "leader-machine",
	payload,
	...overrides,
});

const createMember = (role: "leader" | "member" = "member") => ({
	member_id: payload.memberId,
	agent_team_id: payload.agentTeamId,
	role,
	name: role === "leader" ? "Leader" : "Worker",
	backend_id: "backend-1",
	session_id: role === "leader" ? "leader-session" : "remote-session",
	lifecycle: "running",
	health: "healthy",
	worktree_source_cwd: null,
	worktree_branch: null,
	error_json: null,
	created_at: "2026-07-30T00:00:00.000Z",
	updated_at: "2026-07-30T00:00:00.000Z",
});

const createHarness = (options?: {
	executionRoute?: AgentTeamMemberExecution | null;
	memberRole?: "leader" | "member";
	members?: ReturnType<typeof createMember>[];
	runtimeError?: unknown;
}) => {
	const getTeamMemberExecution = mock(
		(_agentTeamId: string, _memberId: string) =>
			options?.executionRoute === undefined ? route : options.executionRoute,
	);
	const listTeamMembers = mock(
		(_agentTeamId: string) =>
			options?.members ?? [createMember(options?.memberRole)],
	);
	const onMemberTurnCompleted = mock(
		async (_agentTeamId: string, _memberId: string): Promise<void> => {
			if (options?.runtimeError !== undefined) {
				throw options.runtimeError;
			}
		},
	);
	const handler = createLeaderTeamRuntimeRelayHandler({
		store: {
			getTeamMemberExecution,
			listTeamMembers,
		},
		runtime: {
			onMemberTurnCompleted,
		},
	});

	return {
		getTeamMemberExecution,
		handler,
		listTeamMembers,
		onMemberTurnCompleted,
	};
};

const expectSafeError = async (
	run: () => unknown | Promise<unknown>,
	code: "REQUEST_VALIDATION_FAILED" | "AUTHORIZATION_FAILED" | "INTERNAL_ERROR",
): Promise<void> => {
	try {
		await run();
		throw new Error("Expected Team runtime relay to reject");
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).detail).toEqual({
			code,
			message:
				code === "REQUEST_VALIDATION_FAILED"
					? "Invalid Team runtime relay request"
					: code === "AUTHORIZATION_FAILED"
						? "Team runtime relay caller is not authorized"
						: "Internal server error",
			retryable: code === "INTERNAL_ERROR",
			scope: "request",
		});
		expect((error as AppError).detail.detail).toBeUndefined();
	}
};

describe("Team runtime relay payload", () => {
	test("parses only the exact version 1 turn_completed payload", () => {
		expect(parseTeamRuntimeRelayPayload(createRequest())).toEqual({
			version: 1,
			type: "turn_completed",
			operationId: payload.operationId,
			agentTeamId: payload.agentTeamId,
			memberId: payload.memberId,
			turnId: payload.turnId,
		});
	});

	test("rejects unsupported versions, types, extra facts, and outer operation mismatches", async () => {
		const malformedRequests = [
			createRequest({
				payload: { ...payload, version: 2 },
			}),
			createRequest({
				payload: { ...payload, type: "turn_started" },
			}),
			createRequest({
				payload: { ...payload, role: "leader" },
			}),
			createRequest({
				payload: { ...payload, machineId: "forged-machine" },
			}),
			createRequest({
				payload: {
					version: payload.version,
					type: payload.type,
					operationId: payload.operationId,
					agentTeamId: payload.agentTeamId,
					memberId: payload.memberId,
				},
			}),
			createRequest({ operationId: "outer-operation-spoof" }),
			createRequest({ operation: "team.command" }),
		];

		for (const request of malformedRequests) {
			await expectSafeError(
				() => parseTeamRuntimeRelayPayload(request),
				"REQUEST_VALIDATION_FAILED",
			);
		}
	});
});

describe("leader Team runtime relay handler", () => {
	test("uses the leader execution route and member fact before recording turn completion", async () => {
		const harness = createHarness();

		await expect(harness.handler(createRequest())).resolves.toEqual({
			operationId: payload.operationId,
			accepted: true,
		});
		expect(harness.getTeamMemberExecution).toHaveBeenCalledWith(
			payload.agentTeamId,
			payload.memberId,
		);
		expect(harness.listTeamMembers).toHaveBeenCalledWith(payload.agentTeamId);
		expect(harness.onMemberTurnCompleted).toHaveBeenCalledTimes(1);
		expect(harness.onMemberTurnCompleted).toHaveBeenCalledWith(
			payload.agentTeamId,
			payload.memberId,
		);
	});

	test("rejects missing or inconsistent execution routes before touching runtime facts", async () => {
		const routes = [
			null,
			{ ...route, agentTeamId: "other-team" },
			{ ...route, memberId: "other-member" },
			{ ...route, executionMachineId: "other-machine" },
			{ ...route, workerRelayKeyId: "other-relay-key" },
		];

		for (const executionRoute of routes) {
			const harness = createHarness({ executionRoute });
			await expectSafeError(
				() => harness.handler(createRequest()),
				"AUTHORIZATION_FAILED",
			);
			expect(harness.onMemberTurnCompleted).not.toHaveBeenCalled();
		}

		for (const request of [
			createRequest({ sourceMachineId: "other-worker-machine" }),
			createRequest({
				sourceRelayKey: {
					...workerRelayKey,
					keyId: "other-worker-relay-key",
				},
			}),
		]) {
			const harness = createHarness();
			await expectSafeError(
				() => harness.handler(request),
				"AUTHORIZATION_FAILED",
			);
			expect(harness.onMemberTurnCompleted).not.toHaveBeenCalled();
		}
	});

	test("accepts only a non-leader member identity found in the leader store", async () => {
		for (const harness of [
			createHarness({ memberRole: "leader" }),
			createHarness({ members: [] }),
			createHarness({
				members: [{ ...createMember(), agent_team_id: "other-team" }],
			}),
			createHarness({
				members: [{ ...createMember(), member_id: "other-member" }],
			}),
		]) {
			await expectSafeError(
				() => harness.handler(createRequest()),
				"AUTHORIZATION_FAILED",
			);
			expect(harness.onMemberTurnCompleted).not.toHaveBeenCalled();
		}
	});

	test("rejects untrusted payload facts before consulting the leader store", async () => {
		const harness = createHarness();

		await expectSafeError(
			() =>
				harness.handler(
					createRequest({
						payload: {
							...payload,
							role: "member",
							sessionId: "remote-session",
						},
					}),
				),
			"REQUEST_VALIDATION_FAILED",
		);
		expect(harness.getTeamMemberExecution).not.toHaveBeenCalled();
		expect(harness.listTeamMembers).not.toHaveBeenCalled();
		expect(harness.onMemberTurnCompleted).not.toHaveBeenCalled();
	});

	test("converts unexpected runtime failures to a safe error", async () => {
		const harness = createHarness({
			runtimeError: new Error("private leader WAL path"),
		});

		await expectSafeError(
			() => harness.handler(createRequest()),
			"INTERNAL_ERROR",
		);
	});
});
