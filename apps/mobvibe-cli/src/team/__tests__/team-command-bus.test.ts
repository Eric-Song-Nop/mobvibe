import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentTeamStore } from "../agent-team-store.js";
import {
	TeamCommandBus,
	type TeamCommandEnvelope,
} from "../team-command-bus.js";
import { TeamRuntime } from "../team-runtime.js";
import {
	type TeamToolCaller,
	TeamToolHandlers,
	type TeamToolName,
} from "../team-tool-handlers.js";

describe("TeamCommandBus", () => {
	let tempDir: string;
	let store: AgentTeamStore;
	let agentTeamId: string;
	let leaderMemberId: string;
	let workerMemberId: string;
	let spawnMember: ReturnType<typeof mock>;
	let bus: TeamCommandBus;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-command-bus-"));
		store = new AgentTeamStore(path.join(tempDir, "events.db"));
		const created = store.createAgentTeam({
			machineId: "leader-machine",
			workspaceRootCwd: "/workspace",
			backendId: "backend-1",
			title: "Command Team",
			leaderName: "Leader",
		});
		agentTeamId = created.team.agentTeamId;
		leaderMemberId = created.team.leaderMemberId;
		workerMemberId = store.addTeamMember({
			agentTeamId,
			backendId: "backend-2",
			name: "Worker",
			role: "member",
		}).memberId;
		spawnMember = mock(
			(caller: TeamToolCaller, args: { name?: string; backendId?: string }) =>
				Promise.resolve({
					ok: true as const,
					memberId: "spawned-member",
					sessionId: "spawned-session",
					backendId: args.backendId ?? "backend-1",
					name: args.name ?? "Member",
					requestedByMemberId: caller.memberId,
				}),
		);
		const handlers = new TeamToolHandlers({
			store,
			services: { spawnMember },
		});
		bus = new TeamCommandBus({ store, handlers });
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("lists members through the existing tool and derives caller role locally", async () => {
		const execution = await bus.dispatch(
			command("operation-members", "mobvibe_team_members", {}, workerMemberId),
		);

		expect(execution.operationId).toBe("operation-members");
		expect(execution.result).toEqual({
			caller: {
				agentTeamId,
				memberId: workerMemberId,
				role: "member",
			},
			toolName: "mobvibe_team_members",
			data: [
				expect.objectContaining({
					memberId: leaderMemberId,
					name: "Leader",
					role: "leader",
				}),
				expect.objectContaining({
					memberId: workerMemberId,
					name: "Worker",
					role: "member",
				}),
			],
		});
	});

	test("preserves send_message semantics and authoritative caller identity", async () => {
		const execution = await bus.dispatch(
			command(
				"operation-send",
				"mobvibe_team_send_message",
				{
					to: workerMemberId,
					message: "leader-local body",
					fromMemberId: workerMemberId,
				},
				leaderMemberId,
			),
		);

		expect(execution.operationId).toBe("operation-send");
		expect(execution.result.caller).toEqual({
			agentTeamId,
			memberId: leaderMemberId,
			role: "leader",
		});
		expect(execution.result.data).toEqual(
			expect.objectContaining({
				ok: true,
				deliveries: [
					expect.objectContaining({
						fromMemberId: leaderMemberId,
						toMemberId: workerMemberId,
					}),
				],
			}),
		);
		expect(JSON.stringify(execution.result.data)).not.toContain(
			"leader-local body",
		);
	});

	test("preserves spawn_member semantics with the store-derived caller", async () => {
		const execution = await bus.dispatch(
			command(
				"operation-spawn",
				"mobvibe_team_spawn_member",
				{ name: "Reviewer", backendId: "backend-3" },
				workerMemberId,
			),
		);

		expect(execution.result.data).toEqual({
			ok: true,
			memberId: "spawned-member",
			sessionId: "spawned-session",
			backendId: "backend-3",
			name: "Reviewer",
			requestedByMemberId: workerMemberId,
		});
		expect(spawnMember).toHaveBeenCalledWith(
			{
				agentTeamId,
				memberId: workerMemberId,
				role: "member",
			},
			{ name: "Reviewer", backendId: "backend-3" },
		);
	});

	test("preserves task_create, task_list, and task_update semantics", async () => {
		const created = await bus.dispatch(
			command("operation-create", "mobvibe_team_task_create", {
				title: "Implement command bus",
				description: "Leader-local task body",
				owner: "Worker",
			}),
		);
		expect(created.result.data).toEqual(
			expect.objectContaining({
				ok: true,
				task: expect.objectContaining({
					title: "Implement command bus",
					description: "Leader-local task body",
					ownerMemberId: workerMemberId,
					status: "todo",
				}),
			}),
		);
		const taskId = store.listLocalTasks(agentTeamId)[0].task_id;

		const listed = await bus.dispatch(
			command("operation-list", "mobvibe_team_task_list", {}),
		);
		expect(listed.result.data).toEqual(
			expect.objectContaining({
				ok: true,
				tasks: [
					expect.objectContaining({
						taskId,
						title: "Implement command bus",
					}),
				],
			}),
		);

		const updated = await bus.dispatch(
			command("operation-update", "mobvibe_team_task_update", {
				taskId,
				status: "completed",
			}),
		);
		expect(updated.result.data).toEqual(
			expect.objectContaining({
				ok: true,
				task: expect.objectContaining({
					taskId,
					status: "completed",
				}),
			}),
		);
	});

	test("returns existing structured tool validation errors unchanged", async () => {
		const execution = await bus.dispatch(
			command("operation-invalid-send", "mobvibe_team_send_message", {
				to: workerMemberId,
			}),
		);

		expect(execution.result.data).toEqual(
			expect.objectContaining({
				ok: false,
				deliveries: [],
				error: expect.objectContaining({
					code: "REQUEST_VALIDATION_FAILED",
				}),
			}),
		);
	});

	test("fails closed for an unknown command before changing leader-local facts", async () => {
		const unsupported = {
			...command("operation-unknown", "mobvibe_team_members", {}),
			toolName: "mobvibe_team_delete",
		} as unknown as TeamCommandEnvelope;

		await expect(bus.dispatch(unsupported)).rejects.toThrow(
			"Unsupported Team command",
		);
		expect(store.listLocalTasks(agentTeamId)).toHaveLength(0);
	});

	test("fails closed when the caller is not in the authoritative Team store", async () => {
		await expect(
			bus.dispatch(
				command(
					"operation-orphan",
					"mobvibe_team_members",
					{},
					"missing-member",
				),
			),
		).rejects.toThrow("Team command caller not found");
	});

	test("rejects an envelope without a non-empty operationId", async () => {
		await expect(
			bus.dispatch(command("", "mobvibe_team_members", {})),
		).rejects.toThrow("operationId");
	});

	test("fails closed for missing or unsupported envelope versions", async () => {
		const supported = command("operation-version", "mobvibe_team_members", {});
		const { version: _version, ...missingVersion } = supported;

		await expect(
			bus.dispatch(missingVersion as TeamCommandEnvelope),
		).rejects.toThrow("version");
		await expect(
			bus.dispatch({
				...supported,
				version: 2,
			} as unknown as TeamCommandEnvelope),
		).rejects.toThrow("version");
	});

	test("TeamRuntime routes through the single command bus it constructs", async () => {
		const runtime = new TeamRuntime({
			store,
			services: { spawnMember },
		});
		const originalDispatch = runtime.commandBus.dispatch.bind(
			runtime.commandBus,
		);
		const dispatch = mock((envelope: TeamCommandEnvelope) =>
			originalDispatch(envelope),
		);
		runtime.commandBus.dispatch = dispatch;
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		runtime.mcpRouter.handleConnect({ serverId });

		await runtime.mcpRouter.handleToolCall({
			serverId,
			toolName: "mobvibe_team_members",
			args: {},
		});

		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	function command(
		operationId: string,
		toolName: TeamToolName,
		args: unknown,
		callerMemberId = leaderMemberId,
	): TeamCommandEnvelope {
		return {
			version: 1,
			operationId,
			agentTeamId,
			callerMemberId,
			toolName,
			args,
		} as TeamCommandEnvelope;
	}
});
