import {
	type AgentTeamSummary,
	AppError,
	type CliRegistrationInfo,
	type SessionSummary,
	type TeamRelayCiphertext,
	type TeamRelayPublicKey,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CliRecord, CliRegistry } from "../cli-registry.js";
import { TeamRouter } from "../team-router.js";

const createMockSocket = (id: string) =>
	({
		id,
		emit: vi.fn(),
		on: vi.fn(),
		join: vi.fn(),
		leave: vi.fn(),
		disconnect: vi.fn(),
	}) as unknown as Socket & { emit: ReturnType<typeof vi.fn> };

const createRegistration = (
	machineId: string,
	teamRelayKey?: TeamRelayPublicKey,
): CliRegistrationInfo =>
	({
		machineId,
		hostname: `${machineId}-host`,
		version: "1.0.0",
		backends: [{ backendId: "backend-1", backendLabel: "Claude Code" }],
		...(teamRelayKey ? { teamRelayKey } : {}),
	}) as CliRegistrationInfo;

const createRelayKey = (seed: number): TeamRelayPublicKey => {
	const publicKey = Buffer.alloc(32, seed).toString("base64");
	return {
		version: 1,
		keyId: `x25519:${publicKey}`,
		publicKey,
	};
};

const createCiphertext = (
	recipientKeyId: string,
	seed = 1,
): TeamRelayCiphertext => ({
	version: 1,
	recipientKeyId,
	wrappedDek: Buffer.alloc(80, seed).toString("base64"),
	payload: {
		t: "encrypted",
		c: Buffer.alloc(64, seed).toString("base64"),
	},
});

const markRelayReady = (registry: CliRegistry, record: CliRecord): void => {
	if (!record.teamRelayKey || !record.teamRelayRegistrationId) {
		throw new Error("Relay-ready test fixture requires a relay registration");
	}
	const marked = registry.markTeamRelayReady(record.socket.id, {
		registrationId: record.teamRelayRegistrationId,
		relayKeyId: record.teamRelayKey.keyId,
	});
	if (!marked) {
		throw new Error("Failed to mark relay-ready test fixture");
	}
};

type TeamRelayRouterUnderTest = TeamRouter & {
	placeRelayPeer(
		params: unknown,
		source: CliRecord,
	): Promise<{
		targetMachineId: string;
		relayKey: TeamRelayPublicKey;
	}>;
	resolveRelayPeer(
		params: unknown,
		source: CliRecord,
	): Promise<{
		targetMachineId: string;
		relayKey: TeamRelayPublicKey;
	}>;
	relay(
		params: unknown,
		source: CliRecord,
	): Promise<{
		operationId: string;
		targetMachineId: string;
		ciphertext: TeamRelayCiphertext;
	}>;
};

const createTeam = (
	overrides: Partial<AgentTeamSummary> = {},
): AgentTeamSummary => ({
	agentTeamId: "team-1",
	machineId: "machine-1",
	title: "Team One",
	workspaceRootCwd: "/repo",
	workspaceMode: "shared_workspace",
	leaderMemberId: "member-1",
	lifecycle: "pending",
	members: [],
	mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
	taskCounts: {
		todo: 0,
		inProgress: 0,
		blocked: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
	},
	createdAt: "2026-05-13T00:00:00.000Z",
	updatedAt: "2026-05-13T00:00:00.000Z",
	...overrides,
});

const createSession = (
	overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
	sessionId: "leader-session",
	title: "Leader",
	backendId: "backend-1",
	backendLabel: "Claude Code",
	createdAt: "2026-05-13T00:00:00.000Z",
	updatedAt: "2026-05-13T00:00:00.000Z",
	...overrides,
});

describe("TeamRouter", () => {
	let cliRegistry: CliRegistry;
	let teamRouter: TeamRouter;
	let socket: ReturnType<typeof createMockSocket>;

	beforeEach(() => {
		cliRegistry = new CliRegistry();
		teamRouter = new TeamRouter(cliRegistry);
		socket = createMockSocket("socket-1");
		cliRegistry.register(socket, createRegistration("machine-1"), {
			userId: "user-1",
			deviceId: "device-1",
		});
	});

	it("forwards create requests to the user's machine CLI", async () => {
		const team = createTeam({ machineId: "untrusted-cli-machine" });
		const leaderSession = createSession();
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-team:create") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { team, leaderSession },
					});
				}, 0);
			}
		});

		const result = await teamRouter.createAgentTeam(
			{
				machineId: "machine-1",
				backendId: "backend-1",
				workspaceRootCwd: "/repo",
				title: "Team One",
			},
			"user-1",
		);

		expect(result.team).toEqual({ ...team, machineId: "machine-1" });
		expect(result.leaderSession).toEqual({
			...leaderSession,
			machineId: "machine-1",
		});
		expect(socket.emit).toHaveBeenCalledWith(
			"rpc:agent-team:create",
			expect.objectContaining({
				params: {
					machineId: "machine-1",
					backendId: "backend-1",
					workspaceRootCwd: "/repo",
					title: "Team One",
				},
			}),
		);
	});

	it("fans out list requests across current user's CLIs", async () => {
		const socket2 = createMockSocket("socket-2");
		cliRegistry.register(socket2, createRegistration("machine-2"), {
			userId: "user-1",
			deviceId: "device-2",
		});
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-teams:list") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: {
							teams: [createTeam({ machineId: "untrusted-machine" })],
						},
					});
				}, 0);
			}
		});
		socket2.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-teams:list") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: {
							teams: [
								createTeam({
									agentTeamId: "team-2",
									machineId: "untrusted-machine",
								}),
							],
						},
					});
				}, 0);
			}
		});

		const result = await teamRouter.listAgentTeams({}, "user-1");

		expect(result.teams.map((team) => team.agentTeamId)).toEqual([
			"team-1",
			"team-2",
		]);
		expect(result.teams.map((team) => team.machineId)).toEqual([
			"machine-1",
			"machine-2",
		]);
		expect(result.coveredLeaderMachineIds).toEqual(["machine-1", "machine-2"]);
		expect(socket.emit).toHaveBeenCalledWith(
			"rpc:agent-teams:list",
			expect.objectContaining({ params: { machineId: "machine-1" } }),
		);
		expect(socket2.emit).toHaveBeenCalledWith(
			"rpc:agent-teams:list",
			expect.objectContaining({ params: { machineId: "machine-2" } }),
		);
	});

	it("covers only the online leader when another leader is offline", async () => {
		const socket2 = createMockSocket("socket-2");
		cliRegistry.register(socket2, createRegistration("machine-2"), {
			userId: "user-1",
			deviceId: "device-2",
		});
		cliRegistry.unregister(socket.id);
		socket2.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-teams:list") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: {
							teams: [
								createTeam({ agentTeamId: "team-2", machineId: "machine-2" }),
							],
						},
					});
				}, 0);
			}
		});

		const result = await teamRouter.listAgentTeams({}, "user-1");

		expect(result.teams.map((team) => team.agentTeamId)).toEqual(["team-2"]);
		expect(result.coveredLeaderMachineIds).toEqual(["machine-2"]);
		expect(socket.emit).not.toHaveBeenCalledWith(
			"rpc:agent-teams:list",
			expect.anything(),
		);
	});

	it("reports directed leader coverage only after its query succeeds", async () => {
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-teams:list") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { teams: [createTeam()] },
					});
				}, 0);
			}
		});

		const result = await teamRouter.listAgentTeams(
			{ machineId: "machine-1" },
			"user-1",
		);

		expect(result.teams).toEqual([createTeam()]);
		expect(result.coveredLeaderMachineIds).toEqual(["machine-1"]);
	});

	it("drops a directed result when its machine socket is replaced in flight", async () => {
		const replacementSocket = createMockSocket("socket-replacement");
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-teams:list") {
				setTimeout(() => {
					cliRegistry.register(
						replacementSocket,
						createRegistration("machine-1"),
						{
							userId: "user-1",
							deviceId: "device-replacement",
						},
					);
					teamRouter.handleRpcResponse(
						{
							requestId: request.requestId,
							result: { teams: [createTeam()] },
						},
						socket.id,
					);
				}, 0);
			}
		});

		const result = await teamRouter.listAgentTeams(
			{ machineId: "machine-1" },
			"user-1",
		);

		expect(result).toEqual({
			teams: [],
			coveredLeaderMachineIds: [],
		});
		expect(
			cliRegistry.getCliByMachineIdForUser("machine-1", "user-1")?.socket,
		).toBe(replacementSocket);
	});

	it("omits a connected leader from coverage when its query fails", async () => {
		const socket2 = createMockSocket("socket-2");
		cliRegistry.register(socket2, createRegistration("machine-2"), {
			userId: "user-1",
			deviceId: "device-2",
		});
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-teams:list") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						error: {
							code: "INTERNAL_ERROR",
							message: "machine-1 unavailable",
							retryable: true,
							scope: "service",
							status: 503,
						},
					});
				}, 0);
			}
		});
		socket2.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-teams:list") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: {
							teams: [
								createTeam({ agentTeamId: "team-2", machineId: "machine-2" }),
							],
						},
					});
				}, 0);
			}
		});

		const result = await teamRouter.listAgentTeams({}, "user-1");

		expect(result.teams.map((team) => team.agentTeamId)).toEqual(["team-2"]);
		expect(result.coveredLeaderMachineIds).toEqual(["machine-2"]);
	});

	it("rejects a global list when no CLI is connected", async () => {
		cliRegistry.unregister(socket.id);

		await expect(teamRouter.listAgentTeams({}, "user-1")).rejects.toThrow(
			"No CLI connected for this user",
		);
	});

	it("returns missing team result through get without leaking another machine", async () => {
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-team:get") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: {},
					});
				}, 0);
			}
		});

		const result = await teamRouter.getAgentTeam(
			{ agentTeamId: "missing", machineId: "machine-1" },
			"user-1",
		);

		expect(result).toEqual({});
		expect(socket.emit).toHaveBeenCalledWith(
			"rpc:agent-team:get",
			expect.objectContaining({
				params: { agentTeamId: "missing", machineId: "machine-1" },
			}),
		);
	});

	it("finds a machine-neutral Team detail on its actual leader machine", async () => {
		const socket2 = createMockSocket("socket-2");
		cliRegistry.register(socket2, createRegistration("machine-2"), {
			userId: "user-1",
			deviceId: "device-2",
		});
		socket.emit.mockImplementation((event, request) => {
			if (event !== "rpc:agent-team:get") return;
			teamRouter.handleRpcResponse(
				{ requestId: request.requestId, result: {} },
				socket.id,
			);
		});
		socket2.emit.mockImplementation((event, request) => {
			if (event !== "rpc:agent-team:get") return;
			teamRouter.handleRpcResponse(
				{
					requestId: request.requestId,
					result: {
						team: createTeam({
							agentTeamId: "team-on-machine-2",
							machineId: "forged-machine",
						}),
					},
				},
				socket2.id,
			);
		});

		const result = await teamRouter.getAgentTeam(
			{ agentTeamId: "team-on-machine-2" },
			"user-1",
		);

		expect(result.team).toMatchObject({
			agentTeamId: "team-on-machine-2",
			machineId: "machine-2",
		});
		expect(socket.emit).toHaveBeenCalledWith(
			"rpc:agent-team:get",
			expect.objectContaining({
				params: {
					agentTeamId: "team-on-machine-2",
					machineId: "machine-1",
				},
			}),
		);
		expect(socket2.emit).toHaveBeenCalledWith(
			"rpc:agent-team:get",
			expect.objectContaining({
				params: {
					agentTeamId: "team-on-machine-2",
					machineId: "machine-2",
				},
			}),
		);
	});

	it("fails closed when two leader machines claim the same Team ID", async () => {
		const socket2 = createMockSocket("socket-2");
		cliRegistry.register(socket2, createRegistration("machine-2"), {
			userId: "user-1",
			deviceId: "device-2",
		});
		for (const [candidateSocket, machineId] of [
			[socket, "machine-1"],
			[socket2, "machine-2"],
		] as const) {
			candidateSocket.emit.mockImplementation((event, request) => {
				if (event !== "rpc:agent-team:get") return;
				teamRouter.handleRpcResponse(
					{
						requestId: request.requestId,
						result: {
							team: createTeam({
								agentTeamId: "colliding-team",
								machineId,
							}),
						},
					},
					candidateSocket.id,
				);
			});
		}

		await expect(
			teamRouter.getAgentTeam({ agentTeamId: "colliding-team" }, "user-1"),
		).rejects.toMatchObject({ status: 409 });
	});

	it("canonicalizes a directed Team detail and drops a replaced registration response", async () => {
		const replacementSocket = createMockSocket("socket-replacement");
		socket.emit.mockImplementation((event, request) => {
			if (event !== "rpc:agent-team:get") return;
			cliRegistry.register(replacementSocket, createRegistration("machine-1"), {
				userId: "user-1",
				deviceId: "device-replacement",
			});
			teamRouter.handleRpcResponse(
				{
					requestId: request.requestId,
					result: {
						team: createTeam({ machineId: "forged-machine" }),
					},
				},
				socket.id,
			);
		});

		const result = await teamRouter.getAgentTeam(
			{ agentTeamId: "team-1", machineId: "machine-1" },
			"user-1",
		);

		expect(result).toEqual({});
	});

	it("rejects machine ownership mismatch before RPC forwarding", async () => {
		await expect(
			teamRouter.createAgentTeam(
				{
					machineId: "machine-1",
					backendId: "backend-1",
					workspaceRootCwd: "/repo",
				},
				"user-2",
			),
		).rejects.toThrow("Machine not found");
		expect(socket.emit).not.toHaveBeenCalled();
	});

	it("preserves structured RPC errors and status metadata", async () => {
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-team:create") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						error: {
							code: "REQUEST_VALIDATION_FAILED",
							message: "invalid team",
							retryable: false,
							scope: "request",
							status: 422,
							detail: "title conflicts with an existing team",
						},
					});
				}, 0);
			}
		});

		const error = await teamRouter
			.createAgentTeam(
				{
					machineId: "machine-1",
					backendId: "backend-1",
					workspaceRootCwd: "/repo",
				},
				"user-1",
			)
			.catch((caught: unknown) => caught as AppError);

		expect(error).toBeInstanceOf(AppError);
		if (!(error instanceof AppError)) {
			throw new Error("Expected createAgentTeam to reject with AppError");
		}
		expect(error).toMatchObject({
			status: 422,
			detail: {
				code: "REQUEST_VALIDATION_FAILED",
				message: "invalid team",
				retryable: false,
				scope: "request",
				detail: "title conflicts with an existing team",
			},
		});
	});

	it("sanitizes internal Team RPC errors", async () => {
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-team:create") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						error: {
							code: "INTERNAL_ERROR",
							message: "ENOENT /Users/alice/private/team.json",
							retryable: true,
							scope: "request",
							status: 500,
							detail: "secret stack trace",
						},
					});
				}, 0);
			}
		});

		const error = await teamRouter
			.createAgentTeam(
				{
					machineId: "machine-1",
					backendId: "backend-1",
					workspaceRootCwd: "/repo",
				},
				"user-1",
			)
			.catch((caught: unknown) => caught as AppError);

		expect(error).toBeInstanceOf(AppError);
		if (!(error instanceof AppError)) {
			throw new Error("Expected createAgentTeam to reject with AppError");
		}
		expect(error).toMatchObject({
			status: 500,
			detail: {
				code: "INTERNAL_ERROR",
				message: "Internal server error",
				retryable: true,
				scope: "request",
			},
		});
		expect(error.detail.detail).toBeUndefined();
	});

	it("rejects pending team RPCs immediately when their CLI disconnects", async () => {
		socket.emit.mockImplementation(() => undefined);
		const pending = teamRouter.createAgentTeam(
			{
				machineId: "machine-1",
				backendId: "backend-1",
				workspaceRootCwd: "/repo",
			},
			"user-1",
		);

		teamRouter.handleCliDisconnect(socket.id);

		await expect(pending).rejects.toThrow("CLI disconnected");
	});

	it("ignores team RPC responses from a different CLI socket", async () => {
		let requestId: string | undefined;
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-team:create") requestId = request.requestId;
		});
		const pending = teamRouter.createAgentTeam(
			{
				machineId: "machine-1",
				backendId: "backend-1",
				workspaceRootCwd: "/repo",
			},
			"user-1",
		);
		expect(requestId).toBeDefined();

		teamRouter.handleRpcResponse(
			{
				requestId: requestId as string,
				result: {
					team: createTeam({ agentTeamId: "spoofed-team" }),
				},
			},
			"attacker-socket",
		);
		teamRouter.handleRpcResponse(
			{
				requestId: requestId as string,
				result: { team: createTeam({ agentTeamId: "valid-team" }) },
			},
			socket.id,
		);

		await expect(pending).resolves.toMatchObject({
			team: { agentTeamId: "valid-team" },
		});
	});

	describe("opaque cross-machine relay", () => {
		let relayRouter: TeamRelayRouterUnderTest;
		let source: CliRecord;
		let targetSocket: ReturnType<typeof createMockSocket>;
		let sourceRelayKey: TeamRelayPublicKey;
		let targetRelayKey: TeamRelayPublicKey;

		beforeEach(() => {
			sourceRelayKey = createRelayKey(1);
			targetRelayKey = createRelayKey(2);
			source = cliRegistry.register(
				socket,
				createRegistration("machine-1", sourceRelayKey),
				{
					userId: "user-1",
					deviceId: "device-1",
				},
			);
			markRelayReady(cliRegistry, source);
			targetSocket = createMockSocket("socket-2");
			const target = cliRegistry.register(
				targetSocket,
				createRegistration("machine-2", targetRelayKey),
				{
					userId: "user-1",
					deviceId: "device-2",
				},
			);
			markRelayReady(cliRegistry, target);
			relayRouter = teamRouter as TeamRelayRouterUnderTest;
		});

		it("resolves only an online same-user peer with its relay key", async () => {
			await expect(
				relayRouter.resolveRelayPeer({ targetMachineId: "machine-2" }, source),
			).resolves.toEqual({
				targetMachineId: "machine-2",
				relayKey: targetRelayKey,
			});
		});

		it("places on a same-user worker with the requested backend and excludes the source", async () => {
			await expect(
				relayRouter.placeRelayPeer({ backendId: "backend-1" }, source),
			).resolves.toEqual({
				targetMachineId: "machine-2",
				relayKey: targetRelayKey,
			});
		});

		it("keeps registered but unready peers and sources out of relay routing", async () => {
			const unreadyTargetSocket = createMockSocket("socket-unready-target");
			const unreadyTarget = cliRegistry.register(
				unreadyTargetSocket,
				createRegistration("machine-0", createRelayKey(8)),
				{
					userId: "user-1",
					deviceId: "device-unready-target",
				},
			);

			await expect(
				relayRouter.placeRelayPeer({ backendId: "backend-1" }, source),
			).resolves.toEqual({
				targetMachineId: "machine-2",
				relayKey: targetRelayKey,
			});
			await expect(
				relayRouter.resolveRelayPeer(
					{ targetMachineId: unreadyTarget.machineId },
					source,
				),
			).rejects.toThrow("Team relay unavailable");

			const unreadySourceSocket = createMockSocket("socket-unready-source");
			const unreadySource = cliRegistry.register(
				unreadySourceSocket,
				createRegistration("machine-unready-source", createRelayKey(9)),
				{
					userId: "user-1",
					deviceId: "device-unready-source",
				},
			);
			await expect(
				relayRouter.placeRelayPeer({ backendId: "backend-1" }, unreadySource),
			).rejects.toThrow("Team relay unavailable");
		});

		it("selects an eligible worker deterministically by machine ID", async () => {
			const laterSocket = createMockSocket("socket-later");
			const later = cliRegistry.register(
				laterSocket,
				createRegistration("machine-z", createRelayKey(7)),
				{
					userId: "user-1",
					deviceId: "device-later",
				},
			);
			markRelayReady(cliRegistry, later);
			const firstSocket = createMockSocket("socket-first");
			const firstRelayKey = createRelayKey(6);
			const first = cliRegistry.register(
				firstSocket,
				createRegistration("machine-0", firstRelayKey),
				{
					userId: "user-1",
					deviceId: "device-first",
				},
			);
			markRelayReady(cliRegistry, first);

			await expect(
				relayRouter.placeRelayPeer({ backendId: "backend-1" }, source),
			).resolves.toEqual({
				targetMachineId: "machine-0",
				relayKey: firstRelayKey,
			});
		});

		it("filters no-key, wrong-backend, offline, and cross-user workers without leaking topology", async () => {
			cliRegistry.unregister(targetSocket.id);
			const noKeySocket = createMockSocket("socket-place-no-key");
			cliRegistry.register(
				noKeySocket,
				createRegistration("machine-place-no-key"),
				{
					userId: "user-1",
					deviceId: "device-place-no-key",
				},
			);
			const wrongBackendSocket = createMockSocket("socket-place-wrong-backend");
			const wrongBackend = cliRegistry.register(
				wrongBackendSocket,
				{
					...createRegistration(
						"machine-place-wrong-backend",
						createRelayKey(5),
					),
					backends: [
						{ backendId: "other-backend", backendLabel: "Other Agent" },
					],
				},
				{
					userId: "user-1",
					deviceId: "device-place-wrong-backend",
				},
			);
			markRelayReady(cliRegistry, wrongBackend);
			const crossUserSocket = createMockSocket("socket-place-cross-user");
			const crossUser = cliRegistry.register(
				crossUserSocket,
				createRegistration("machine-place-cross-user", createRelayKey(6)),
				{
					userId: "user-2",
					deviceId: "device-place-cross-user",
				},
			);
			markRelayReady(cliRegistry, crossUser);

			await expect(
				relayRouter.placeRelayPeer({ backendId: "backend-1" }, source),
			).rejects.toThrow("Team relay peer not found");
			expect(noKeySocket.emit).not.toHaveBeenCalled();
			expect(wrongBackendSocket.emit).not.toHaveBeenCalled();
			expect(crossUserSocket.emit).not.toHaveBeenCalled();
		});

		it.each([
			["missing backend", {}],
			["empty backend", { backendId: "" }],
			["blank backend", { backendId: "   " }],
			["oversized backend", { backendId: "x".repeat(257) }],
			["oversized UTF-8 backend", { backendId: "界".repeat(86) }],
			[
				"forged source",
				{ backendId: "backend-1", sourceMachineId: "victim-machine" },
			],
			[
				"Team identifier",
				{ backendId: "backend-1", agentTeamId: "team-secret" },
			],
			[
				"member identifier",
				{ backendId: "backend-1", memberId: "member-secret" },
			],
			[
				"Team data",
				{ backendId: "backend-1", team: { title: "must-not-reach-gateway" } },
			],
		])("rejects placement input with %s", async (_label, params) => {
			await expect(relayRouter.placeRelayPeer(params, source)).rejects.toThrow(
				"Invalid Team relay request",
			);
			expect(targetSocket.emit).not.toHaveBeenCalled();
		});

		it("requires the authenticated placement source to have a relay key", async () => {
			const noKeySourceSocket = createMockSocket("socket-place-source-no-key");
			const noKeySource = cliRegistry.register(
				noKeySourceSocket,
				createRegistration("machine-place-source-no-key"),
				{
					userId: "user-1",
					deviceId: "device-place-source-no-key",
				},
			);

			await expect(
				relayRouter.placeRelayPeer({ backendId: "backend-1" }, noKeySource),
			).rejects.toThrow("Team relay unavailable");
			expect(targetSocket.emit).not.toHaveBeenCalled();
		});

		it("stamps authenticated source identity and forwards ciphertext unchanged", async () => {
			const requestCiphertext = createCiphertext(targetRelayKey.keyId, 3);
			const responseCiphertext = createCiphertext(sourceRelayKey.keyId, 4);
			let forwardedRequest:
				| {
						requestId: string;
						params: Record<string, unknown>;
				  }
				| undefined;
			targetSocket.emit.mockImplementation((event, request) => {
				if (event !== "rpc:team-relay:execute") {
					return;
				}
				forwardedRequest = request;
				setTimeout(() => {
					teamRouter.handleRpcResponse(
						{
							requestId: request.requestId,
							result: {
								operationId: "operation-1",
								ciphertext: responseCiphertext,
							},
						},
						targetSocket.id,
					);
				}, 0);
			});

			await expect(
				relayRouter.relay(
					{
						operationId: "operation-1",
						targetMachineId: "machine-2",
						ciphertext: requestCiphertext,
					},
					source,
				),
			).resolves.toEqual({
				operationId: "operation-1",
				targetMachineId: "machine-2",
				ciphertext: responseCiphertext,
			});

			expect(forwardedRequest?.params).toEqual({
				operationId: "operation-1",
				sourceMachineId: "machine-1",
				sourceRelayKey,
				ciphertext: requestCiphertext,
			});
			expect(forwardedRequest?.params.ciphertext).toBe(requestCiphertext);
			expect(forwardedRequest?.params).not.toHaveProperty("command");
			expect(forwardedRequest?.params).not.toHaveProperty("body");
			expect(forwardedRequest?.params).not.toHaveProperty("args");
		});

		it.each([
			["forged source machine", { sourceMachineId: "victim-machine" }],
			["forged source key", { sourceRelayKey: createRelayKey(9) }],
			["plaintext command", { command: "spawn_member" }],
			["plaintext body", { body: { prompt: "must stay encrypted" } }],
			["duplicate recipient key", { recipientKeyId: "duplicate-key-id" }],
		])("rejects %s fields before forwarding", async (_label, injected) => {
			await expect(
				relayRouter.relay(
					{
						operationId: "operation-extra-field",
						targetMachineId: "machine-2",
						ciphertext: createCiphertext(targetRelayKey.keyId),
						...injected,
					},
					source,
				),
			).rejects.toThrow("Invalid Team relay request");
			expect(targetSocket.emit).not.toHaveBeenCalled();
		});

		it("rejects ciphertext addressed to a different relay key", async () => {
			await expect(
				relayRouter.relay(
					{
						operationId: "operation-wrong-recipient",
						targetMachineId: "machine-2",
						ciphertext: createCiphertext(createRelayKey(8).keyId),
					},
					source,
				),
			).rejects.toThrow("Team relay recipient key mismatch");
			expect(targetSocket.emit).not.toHaveBeenCalled();
		});

		it("rejects malformed encrypted payload encoding before forwarding", async () => {
			const malformedCiphertext = {
				...createCiphertext(targetRelayKey.keyId),
				payload: { t: "encrypted" as const, c: "not-valid-base64" },
			};

			await expect(
				relayRouter.relay(
					{
						operationId: "operation-malformed-ciphertext",
						targetMachineId: "machine-2",
						ciphertext: malformedCiphertext,
					},
					source,
				),
			).rejects.toThrow("Invalid Team relay request");
			expect(targetSocket.emit).not.toHaveBeenCalled();
		});

		it("rejects peers without a relay key", async () => {
			const noKeySocket = createMockSocket("socket-no-key");
			cliRegistry.register(noKeySocket, createRegistration("machine-no-key"), {
				userId: "user-1",
				deviceId: "device-no-key",
			});

			await expect(
				relayRouter.resolveRelayPeer(
					{ targetMachineId: "machine-no-key" },
					source,
				),
			).rejects.toThrow("Team relay unavailable");
			await expect(
				relayRouter.relay(
					{
						operationId: "operation-no-key",
						targetMachineId: "machine-no-key",
						ciphertext: createCiphertext(createRelayKey(6).keyId),
					},
					source,
				),
			).rejects.toThrow("Team relay unavailable");
			expect(noKeySocket.emit).not.toHaveBeenCalled();
		});

		it("rejects an authenticated source without a relay key", async () => {
			const noKeySourceSocket = createMockSocket("socket-source-no-key");
			const noKeySource = cliRegistry.register(
				noKeySourceSocket,
				createRegistration("machine-source-no-key"),
				{
					userId: "user-1",
					deviceId: "device-source-no-key",
				},
			);

			await expect(
				relayRouter.resolveRelayPeer(
					{ targetMachineId: "machine-2" },
					noKeySource,
				),
			).rejects.toThrow("Team relay unavailable");
			await expect(
				relayRouter.relay(
					{
						operationId: "operation-source-no-key",
						targetMachineId: "machine-2",
						ciphertext: createCiphertext(targetRelayKey.keyId),
					},
					noKeySource,
				),
			).rejects.toThrow("Team relay unavailable");
			expect(targetSocket.emit).not.toHaveBeenCalled();
		});

		it("fails closed when a registered peer advertises a malformed relay key", async () => {
			const malformedKeySocket = createMockSocket("socket-malformed-key");
			cliRegistry.register(
				malformedKeySocket,
				{
					...createRegistration("machine-malformed-key"),
					teamRelayKey: {
						version: 1,
						keyId: "x25519:not-base64",
						publicKey: "not-base64",
					},
				} as CliRegistrationInfo,
				{
					userId: "user-1",
					deviceId: "device-malformed-key",
				},
			);

			await expect(
				relayRouter.resolveRelayPeer(
					{ targetMachineId: "machine-malformed-key" },
					source,
				),
			).rejects.toThrow("Team relay unavailable");
			expect(malformedKeySocket.emit).not.toHaveBeenCalled();
		});

		it("does not reveal whether an offline or cross-user target exists", async () => {
			const otherUserSocket = createMockSocket("socket-other-user");
			const otherUser = cliRegistry.register(
				otherUserSocket,
				createRegistration("machine-other-user", createRelayKey(7)),
				{
					userId: "user-2",
					deviceId: "device-other-user",
				},
			);
			markRelayReady(cliRegistry, otherUser);

			for (const targetMachineId of ["machine-offline", "machine-other-user"]) {
				await expect(
					relayRouter.resolveRelayPeer({ targetMachineId }, source),
				).rejects.toThrow("Team relay peer not found");
				await expect(
					relayRouter.relay(
						{
							operationId: `operation-${targetMachineId}`,
							targetMachineId,
							ciphertext: createCiphertext(createRelayKey(7).keyId),
						},
						source,
					),
				).rejects.toThrow("Team relay peer not found");
			}
			expect(otherUserSocket.emit).not.toHaveBeenCalled();
		});

		it("ignores a forged response socket and settles from the real target", async () => {
			const responseCiphertext = createCiphertext(sourceRelayKey.keyId, 5);
			let requestId: string | undefined;
			targetSocket.emit.mockImplementation((event, request) => {
				if (event === "rpc:team-relay:execute") {
					requestId = request.requestId;
				}
			});
			const pending = relayRouter.relay(
				{
					operationId: "operation-socket-binding",
					targetMachineId: "machine-2",
					ciphertext: createCiphertext(targetRelayKey.keyId),
				},
				source,
			);
			await vi.waitFor(() => expect(requestId).toBeDefined());
			let settled = false;
			void pending.finally(() => {
				settled = true;
			});

			teamRouter.handleRpcResponse(
				{
					requestId: requestId as string,
					result: {
						operationId: "operation-socket-binding",
						ciphertext: createCiphertext(sourceRelayKey.keyId, 9),
					},
				},
				"attacker-socket",
			);
			await Promise.resolve();
			expect(settled).toBe(false);

			teamRouter.handleRpcResponse(
				{
					requestId: requestId as string,
					result: {
						operationId: "operation-socket-binding",
						ciphertext: responseCiphertext,
					},
				},
				targetSocket.id,
			);
			await expect(pending).resolves.toEqual({
				operationId: "operation-socket-binding",
				targetMachineId: "machine-2",
				ciphertext: responseCiphertext,
			});
		});

		it.each([
			"operationId",
			"recipientKeyId",
		] as const)("rejects a real target response with a mismatched %s binding", async (mismatch) => {
			targetSocket.emit.mockImplementation((event, request) => {
				if (event !== "rpc:team-relay:execute") {
					return;
				}
				setTimeout(() => {
					teamRouter.handleRpcResponse(
						{
							requestId: request.requestId,
							result: {
								operationId:
									mismatch === "operationId"
										? "operation-response-spoofed"
										: "operation-response-binding",
								ciphertext: createCiphertext(
									mismatch === "recipientKeyId"
										? createRelayKey(9).keyId
										: sourceRelayKey.keyId,
									6,
								),
							},
						},
						targetSocket.id,
					);
				}, 0);
			});

			const error = await relayRouter
				.relay(
					{
						operationId: "operation-response-binding",
						targetMachineId: "machine-2",
						ciphertext: createCiphertext(targetRelayKey.keyId),
					},
					source,
				)
				.catch((caught: unknown) => caught as AppError);

			expect(error).toBeInstanceOf(AppError);
			if (!(error instanceof AppError)) {
				throw new Error("Expected relay to reject with AppError");
			}
			expect(error).toMatchObject({
				status: 502,
				detail: {
					code: "INTERNAL_ERROR",
					message: "Internal server error",
					retryable: true,
					scope: "service",
				},
			});
			expect(error.detail.detail).toBeUndefined();
		});

		it("rejects an in-flight relay immediately when the target disconnects", async () => {
			targetSocket.emit.mockImplementation(() => undefined);
			const pending = relayRouter.relay(
				{
					operationId: "operation-disconnect",
					targetMachineId: "machine-2",
					ciphertext: createCiphertext(targetRelayKey.keyId),
				},
				source,
			);

			teamRouter.handleCliDisconnect(targetSocket.id);

			await expect(pending).rejects.toThrow("CLI disconnected");
		});
	});
});
