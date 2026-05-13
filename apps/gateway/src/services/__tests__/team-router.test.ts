import type { AgentTeamSummary, CliRegistrationInfo } from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliRegistry } from "../cli-registry.js";
import { TeamRouter } from "../team-router.js";

const createMockSocket = (id: string) =>
	({
		id,
		emit: vi.fn(),
		on: vi.fn(),
		join: vi.fn(),
		leave: vi.fn(),
	}) as unknown as Socket & { emit: ReturnType<typeof vi.fn> };

const createRegistration = (machineId: string): CliRegistrationInfo => ({
	machineId,
	hostname: `${machineId}-host`,
	version: "1.0.0",
	backends: [{ backendId: "backend-1", backendLabel: "Claude Code" }],
});

const createTeam = (overrides: Partial<AgentTeamSummary> = {}): AgentTeamSummary => ({
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
						result: { teams: [createTeam({ agentTeamId: "team-2", machineId: "machine-2" })] },
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
					teamRouter.handleRpcResponse({ requestId: request.requestId, result: {} });
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

	it("maps RPC errors and timeouts to rejected promises", async () => {
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
						},
					});
				}, 0);
			}
		});

		await expect(
			teamRouter.createAgentTeam(
				{
					machineId: "machine-1",
					backendId: "backend-1",
					workspaceRootCwd: "/repo",
				},
				"user-1",
			),
		).rejects.toThrow("invalid team");
	});
});
