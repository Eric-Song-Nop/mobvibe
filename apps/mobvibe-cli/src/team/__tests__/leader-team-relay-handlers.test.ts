import { describe, expect, mock, test } from "bun:test";
import { AppError } from "@mobvibe/shared";
import type {
	AgentTeamMemberExecution,
	AgentTeamStore,
} from "../agent-team-store.js";
import {
	createLeaderTeamRelayHandlers,
	type LeaderTeamRelayHandlerStore,
} from "../leader-team-relay-handlers.js";
import {
	TEAM_COMMAND_ENVELOPE_VERSION,
	type TeamCommandDispatcher,
	type TeamCommandEnvelope,
	type TeamCommandExecution,
} from "../team-command-bus.js";
import type { VerifiedTeamRelayRequest } from "../team-relay-protocol.js";

const publicKey = Buffer.alloc(32, 7).toString("base64");
const workerRelayKey = {
	version: 1 as const,
	keyId: `x25519:${publicKey}`,
	publicKey,
};

const command = {
	version: TEAM_COMMAND_ENVELOPE_VERSION,
	operationId: "command-operation-1",
	agentTeamId: "team-1",
	callerMemberId: "member-1",
	toolName: "mobvibe_team_members",
	args: {},
} satisfies TeamCommandEnvelope;

const execution = {
	operationId: command.operationId,
	result: {
		caller: {
			agentTeamId: command.agentTeamId,
			memberId: command.callerMemberId,
			role: "member",
		},
		toolName: command.toolName,
		data: { members: [] },
	},
} satisfies TeamCommandExecution;

const route = {
	agentTeamId: command.agentTeamId,
	memberId: command.callerMemberId,
	executionMachineId: "worker-machine",
	workerRelayKeyId: workerRelayKey.keyId,
	bootstrapOperationId: "bootstrap-operation-1",
	createdAt: "2026-07-30T00:00:00.000Z",
	updatedAt: "2026-07-30T00:00:00.000Z",
} satisfies AgentTeamMemberExecution;

const createRequest = (
	overrides: Partial<VerifiedTeamRelayRequest> = {},
): VerifiedTeamRelayRequest => ({
	operationId: command.operationId,
	operation: "team.command",
	sourceMachineId: route.executionMachineId,
	sourceRelayKey: workerRelayKey,
	targetMachineId: "leader-machine",
	payload: command,
	...overrides,
});

const createMember = (role: "leader" | "member" = "member") => ({
	member_id: command.callerMemberId,
	agent_team_id: command.agentTeamId,
	role,
	name: role === "leader" ? "Leader" : "Worker",
	backend_id: "backend-1",
	session_id: role === "leader" ? "leader-session" : "worker-session",
	lifecycle: "active",
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
	dispatchError?: unknown;
}) => {
	const getTeamMemberExecution = mock(
		(_agentTeamId: string, _memberId: string) =>
			options?.executionRoute === undefined ? route : options.executionRoute,
	);
	const listTeamMembers = mock((_agentTeamId: string) => [
		createMember(options?.memberRole),
	]);
	const store = {
		getTeamMemberExecution,
		listTeamMembers,
	} satisfies LeaderTeamRelayHandlerStore;
	const dispatch = mock(async (_input: TeamCommandEnvelope) => {
		if (options?.dispatchError !== undefined) {
			throw options.dispatchError;
		}
		return execution;
	});
	const dispatcher = { dispatch } satisfies TeamCommandDispatcher;
	const handler = createLeaderTeamRelayHandlers({
		store,
		dispatcher,
	})["team.command"];

	return {
		dispatch,
		getTeamMemberExecution,
		handler,
		listTeamMembers,
		store: store satisfies Pick<
			AgentTeamStore,
			"getTeamMemberExecution" | "listTeamMembers"
		>,
	};
};

const expectSafeError = async (
	run: () => Promise<unknown>,
	code: "REQUEST_VALIDATION_FAILED" | "AUTHORIZATION_FAILED" | "INTERNAL_ERROR",
) => {
	try {
		await run();
		throw new Error("Expected relay handler to reject");
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).detail).toEqual({
			code,
			message:
				code === "REQUEST_VALIDATION_FAILED"
					? "Invalid Team command relay request"
					: code === "AUTHORIZATION_FAILED"
						? "Team command relay caller is not authorized"
						: "Internal server error",
			retryable: code === "INTERNAL_ERROR",
			scope: "request",
		});
		expect((error as AppError).detail.detail).toBeUndefined();
	}
};

describe("leader Team relay command handler", () => {
	test("dispatches a strictly bound remote member command", async () => {
		const harness = createHarness();

		await expect(harness.handler(createRequest())).resolves.toEqual(execution);
		expect(harness.getTeamMemberExecution).toHaveBeenCalledWith(
			command.agentTeamId,
			command.callerMemberId,
		);
		expect(harness.listTeamMembers).toHaveBeenCalledWith(command.agentTeamId);
		expect(harness.dispatch).toHaveBeenCalledTimes(1);
		expect(harness.dispatch).toHaveBeenCalledWith(command);
	});

	test("rejects non-command operations and mismatched operation identities", async () => {
		const harness = createHarness();
		for (const request of [
			createRequest({ operation: "member.runtime" }),
			createRequest({ operationId: "outer-operation-spoof" }),
		]) {
			await expectSafeError(
				() => harness.handler(request),
				"REQUEST_VALIDATION_FAILED",
			);
		}

		expect(harness.getTeamMemberExecution).not.toHaveBeenCalled();
		expect(harness.dispatch).not.toHaveBeenCalled();
	});

	test("rejects malformed or non-strict command payloads before route lookup", async () => {
		const harness = createHarness();
		const malformedPayloads: unknown[] = [
			null,
			{ ...command, extra: "must-not-pass" },
			{ ...command, version: 2 },
			{ ...command, operationId: "" },
			{ ...command, agentTeamId: "" },
			{ ...command, callerMemberId: "" },
			{ ...command, toolName: "unknown_team_tool" },
			{ ...command, args: { value: Number.NaN } },
			{ ...command, args: new Date() },
		];

		for (const payload of malformedPayloads) {
			await expectSafeError(
				() => harness.handler(createRequest({ payload })),
				"REQUEST_VALIDATION_FAILED",
			);
		}

		expect(harness.getTeamMemberExecution).not.toHaveBeenCalled();
		expect(harness.dispatch).not.toHaveBeenCalled();
	});

	test("rejects missing and inconsistent execution routes", async () => {
		const missing = createHarness({ executionRoute: null });
		await expectSafeError(
			() => missing.handler(createRequest()),
			"AUTHORIZATION_FAILED",
		);

		for (const inconsistentRoute of [
			{ ...route, agentTeamId: "other-team" },
			{ ...route, memberId: "other-member" },
			{ ...route, executionMachineId: "other-machine" },
			{ ...route, workerRelayKeyId: "other-relay-key" },
		]) {
			const harness = createHarness({ executionRoute: inconsistentRoute });
			await expectSafeError(
				() => harness.handler(createRequest()),
				"AUTHORIZATION_FAILED",
			);
			expect(harness.dispatch).not.toHaveBeenCalled();
		}
	});

	test("rejects a leader-local caller even if a route is present", async () => {
		const harness = createHarness({ memberRole: "leader" });

		await expectSafeError(
			() => harness.handler(createRequest()),
			"AUTHORIZATION_FAILED",
		);
		expect(harness.dispatch).not.toHaveBeenCalled();
	});

	test("rejects a route whose member identity is absent from leader facts", async () => {
		const harness = createHarness();
		harness.store.listTeamMembers = mock(() => []);
		const handler = createLeaderTeamRelayHandlers({
			store: harness.store,
			dispatcher: { dispatch: harness.dispatch },
		})["team.command"];

		await expectSafeError(
			() => handler(createRequest()),
			"AUTHORIZATION_FAILED",
		);
		expect(harness.dispatch).not.toHaveBeenCalled();
	});

	test("converts unexpected store and dispatcher failures to a safe error", async () => {
		const storeFailure = createHarness();
		storeFailure.store.getTeamMemberExecution = mock(() => {
			throw new Error("private database path: /leader/home/events.db");
		});
		const storeHandler = createLeaderTeamRelayHandlers({
			store: storeFailure.store,
			dispatcher: { dispatch: storeFailure.dispatch },
		})["team.command"];
		await expectSafeError(
			() => storeHandler(createRequest()),
			"INTERNAL_ERROR",
		);

		const dispatchFailure = createHarness({
			dispatchError: new Error("secret tool body"),
		});
		await expectSafeError(
			() => dispatchFailure.handler(createRequest()),
			"INTERNAL_ERROR",
		);
	});
});
