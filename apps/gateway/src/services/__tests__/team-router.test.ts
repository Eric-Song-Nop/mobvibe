import {
	type AgentTeamSummary,
	AppError,
	type CliRegistrationInfo,
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

type TeamRelayRouterUnderTest = TeamRouter & {
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
		const team = createTeam();
		socket.emit.mockImplementation((event, request) => {
			if (event === "rpc:agent-team:create") {
				setTimeout(() => {
					teamRouter.handleRpcResponse({
						requestId: request.requestId,
						result: { team },
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

		expect(result.team).toEqual(team);
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
						result: { teams: [createTeam()] },
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

		expect(result.teams.map((team) => team.agentTeamId)).toEqual([
			"team-1",
			"team-2",
		]);
		expect(socket.emit).toHaveBeenCalledWith(
			"rpc:agent-teams:list",
			expect.objectContaining({ params: { machineId: "machine-1" } }),
		);
		expect(socket2.emit).toHaveBeenCalledWith(
			"rpc:agent-teams:list",
			expect.objectContaining({ params: { machineId: "machine-2" } }),
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
			targetSocket = createMockSocket("socket-2");
			cliRegistry.register(
				targetSocket,
				createRegistration("machine-2", targetRelayKey),
				{
					userId: "user-1",
					deviceId: "device-2",
				},
			);
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
			cliRegistry.register(
				otherUserSocket,
				createRegistration("machine-other-user", createRelayKey(7)),
				{
					userId: "user-2",
					deviceId: "device-other-user",
				},
			);

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
