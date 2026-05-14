import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentTeamStore } from "../agent-team-store.js";
import { TeamMcpRouter } from "../team-mcp-router.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	TeamToolHandlers,
} from "../team-tool-handlers.js";

describe("TeamMcpRouter", () => {
	let tempDir: string;
	let dbPath: string;
	let store: AgentTeamStore;
	let agentTeamId: string;
	let leaderMemberId: string;
	let memberId: string;
	let router: TeamMcpRouter;
	let createSession: ReturnType<typeof mock>;
	let renameSession: ReturnType<typeof mock>;
	let shutdownSession: ReturnType<typeof mock>;
	let requestPermission: ReturnType<typeof mock>;
	let onAgentTeamChanged: ReturnType<typeof mock>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-mcp-router-"));
		dbPath = path.join(tempDir, "events.db");
		store = new AgentTeamStore(dbPath);
		const created = store.createAgentTeam({
			machineId: "machine-1",
			workspaceRootCwd: "/workspace",
			backendId: "backend-1",
			title: "Router Team",
			leaderName: "Leader",
		});
		agentTeamId = created.team.agentTeamId;
		leaderMemberId = created.team.leaderMemberId;
		memberId = store.addTeamMember({
			agentTeamId,
			backendId: "backend-1",
			name: "Worker",
			role: "member",
		}).memberId;
		createSession = mock(() => Promise.resolve(undefined));
		renameSession = mock(() => Promise.resolve(undefined));
		shutdownSession = mock(() => Promise.resolve(undefined));
		requestPermission = mock(() => Promise.resolve(undefined));
		onAgentTeamChanged = mock(() => {});
		const handlers = new TeamToolHandlers({
			store,
			requestPermission,
			onAgentTeamChanged,
		});
		router = new TeamMcpRouter({ store, handlers });
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("mcp/connect binds server id and waits for tools list", () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;

		router.handleConnect({ serverId });

		const team = store.getAgentTeam({ agentTeamId }).team;
		expect(team?.members[0].mcp?.serverId).toBe(serverId);
		expect(team?.members[0].mcp?.phase).toBe("tools_waiting");
		expect(team?.members[0].mcp?.phase).not.toBe("tools_ready");
	});

	test("all expected list-tools names set tools_ready", () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		router.handleListTools({
			serverId,
			toolNames: [...EXPECTED_TEAM_TOOL_NAMES],
		});

		const team = store.getAgentTeam({ agentTeamId }).team;
		expect(team?.members[0].mcp?.phase).toBe("tools_ready");
	});

	test("spawn member is required before tools_ready", () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		router.handleListTools({
			serverId,
			toolNames: EXPECTED_TEAM_TOOL_NAMES.filter(
				(name) => name !== "mobvibe_team_spawn_member",
			),
		});

		const team = store.getAgentTeam({ agentTeamId }).team;
		expect(EXPECTED_TEAM_TOOL_NAMES).toContain("mobvibe_team_spawn_member");
		expect(team?.members[0].mcp?.phase).toBe("degraded");
		expect(team?.members[0].mcp?.phase).not.toBe("tools_ready");
	});

	test("missing expected tool never sets tools_ready", () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		router.handleListTools({
			serverId,
			toolNames: EXPECTED_TEAM_TOOL_NAMES.filter(
				(name) => name !== "mobvibe_team_task_update",
			),
		});

		const team = store.getAgentTeam({ agentTeamId }).team;
		expect(team?.members[0].mcp?.phase).toBe("degraded");
		expect(team?.members[0].mcp?.phase).not.toBe("tools_ready");
	});

	test("tool args cannot override router-bound caller identity", async () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		const result = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_members",
			args: { memberId, fromMemberId: memberId },
		});

		expect(result.caller.memberId).toBe(leaderMemberId);
	});

	test("send_message persists from router-bound caller and ignores spoofed args", async () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		const result = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_send_message",
			args: {
				to: memberId,
				message: "hello from leader",
				fromMemberId: memberId,
			},
		});

		expect(result.caller.memberId).toBe(leaderMemberId);
		expect(result.data).toEqual(
			expect.objectContaining({
				ok: true,
				deliveries: [
					expect.objectContaining({
						fromMemberId: leaderMemberId,
						toMemberId: memberId,
					}),
				],
			}),
		);
		expect(readMailboxRows(dbPath)[0].from_member_id).toBe(leaderMemberId);
	});

	test("send_message emits updated projection without plaintext body", async () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		const result = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_send_message",
			args: { to: "Worker", message: "plaintext should stay local" },
		});

		expect(result.data).toEqual(
			expect.objectContaining({
				ok: true,
				deliveries: [
					expect.objectContaining({ messageId: expect.any(String) }),
				],
			}),
		);
		expect(JSON.stringify(result.data)).not.toContain(
			"plaintext should stay local",
		);
		expect(onAgentTeamChanged).toHaveBeenCalledWith(
			expect.objectContaining({
				agentTeamId,
				sourceRefs: [
					expect.objectContaining({
						type: "mailbox_message",
						fromMemberId: leaderMemberId,
						toMemberId: memberId,
					}),
				],
			}),
		);
		expect(JSON.stringify(onAgentTeamChanged.mock.calls[0][0])).not.toContain(
			"plaintext should stay local",
		);
	});

	test("unknown recipient returns structured tool error and creates no source ref", async () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		const result = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_send_message",
			args: { to: "Missing", message: "do not store" },
		});

		expect(result.data).toEqual(
			expect.objectContaining({
				ok: false,
				deliveries: [],
				error: expect.objectContaining({
					code: "REQUEST_VALIDATION_FAILED",
				}),
			}),
		);
		expect(readMailboxRows(dbPath)).toHaveLength(0);
		expect(onAgentTeamChanged).not.toHaveBeenCalled();
	});

	test("lifecycle requests are durable intents only", async () => {
		const serverId = `mobvibe-team:${agentTeamId}:${memberId}`;
		router.handleConnect({ serverId });

		const intent = await router.recordLifecycleIntent({
			serverId,
			kind: "spawn_member",
			payload: { name: "Extra", prompt: "must not leak to projection" },
			sourceRefs: [],
		});

		expect(intent.status).toBe("requested");
		expect(intent.requestedByMemberId).toBe(memberId);
		expect(createSession).not.toHaveBeenCalled();
		expect(renameSession).not.toHaveBeenCalled();
		expect(shutdownSession).not.toHaveBeenCalled();
	});

	test("leader and non-leader can send messages without confirmation", async () => {
		const leaderServerId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		const memberServerId = `mobvibe-team:${agentTeamId}:${memberId}`;
		router.handleConnect({ serverId: leaderServerId });
		router.handleConnect({ serverId: memberServerId });

		await router.handleToolCall({
			serverId: leaderServerId,
			toolName: "mobvibe_team_send_message",
			args: { to: memberId, message: "from leader" },
		});
		await router.handleToolCall({
			serverId: memberServerId,
			toolName: "mobvibe_team_send_message",
			args: { to: leaderMemberId, message: "from member" },
		});

		expect(requestPermission).not.toHaveBeenCalled();
		expect(readMailboxRows(dbPath)).toHaveLength(2);
	});

	test("task tools create, list, update, and emit projection without local task body", async () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		const created = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_task_create",
			args: {
				title: "Write implementation",
				description: "Local task details",
				owner: "Worker",
			},
		});

		expect(created.data).toEqual(
			expect.objectContaining({
				ok: true,
				task: expect.objectContaining({
					title: "Write implementation",
					description: "Local task details",
					ownerMemberId: memberId,
					status: "todo",
				}),
			}),
		);

		const taskId = readTaskIds(dbPath)[0];
		const listed = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_task_list",
			args: {},
		});
		expect(listed.data).toEqual(
			expect.objectContaining({
				ok: true,
				tasks: [
					expect.objectContaining({
						taskId,
						title: "Write implementation",
						description: "Local task details",
					}),
				],
			}),
		);

		const updated = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_task_update",
			args: { taskId, status: "completed" },
		});

		expect(updated.data).toEqual(
			expect.objectContaining({
				ok: true,
				task: expect.objectContaining({ status: "completed" }),
			}),
		);
		expect(onAgentTeamChanged).toHaveBeenCalledWith(
			expect.objectContaining({
				agentTeamId,
				taskCounts: expect.objectContaining({ completed: 1 }),
			}),
		);
		expect(
			JSON.stringify(onAgentTeamChanged.mock.calls.at(-1)?.[0]),
		).not.toContain("Local task details");
	});

	test("task tools reject pending and deleted statuses", async () => {
		const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		router.handleConnect({ serverId });

		const pending = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_task_create",
			args: { title: "Bad", status: "pending" },
		});
		expect(pending.data).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.objectContaining({ code: "REQUEST_VALIDATION_FAILED" }),
			}),
		);

		const created = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_task_create",
			args: { title: "Valid" },
		});
		const taskId = (created.data as { task: { taskId: string } }).task.taskId;
		const deleted = await router.handleToolCall({
			serverId,
			toolName: "mobvibe_team_task_update",
			args: { taskId, status: "deleted" },
		});
		expect(deleted.data).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.objectContaining({ code: "REQUEST_VALIDATION_FAILED" }),
			}),
		);
	});

	test("leader and non-leader can call task tools without permission confirmation", async () => {
		const leaderServerId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		const memberServerId = `mobvibe-team:${agentTeamId}:${memberId}`;
		router.handleConnect({ serverId: leaderServerId });
		router.handleConnect({ serverId: memberServerId });

		await router.handleToolCall({
			serverId: leaderServerId,
			toolName: "mobvibe_team_task_create",
			args: { title: "Leader task" },
		});
		await router.handleToolCall({
			serverId: memberServerId,
			toolName: "mobvibe_team_task_list",
			args: {},
		});
		await router.handleToolCall({
			serverId: memberServerId,
			toolName: "mobvibe_team_task_update",
			args: { taskId: readTaskIds(dbPath)[0], status: "in_progress" },
		});

		expect(requestPermission).not.toHaveBeenCalled();
	});
});

type MailboxRow = {
	from_member_id: string;
	to_member_id: string | null;
	source_refs_json: string | null;
};

function readMailboxRows(dbPath: string): MailboxRow[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.query(
				"SELECT from_member_id, to_member_id, source_refs_json FROM agent_team_mailbox_messages ORDER BY created_at ASC",
			)
			.all() as MailboxRow[];
	} finally {
		db.close();
	}
}

function readTaskIds(dbPath: string): string[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		const rows = db
			.query("SELECT task_id FROM agent_team_tasks ORDER BY created_at ASC")
			.all() as Array<{ task_id: string }>;
		return rows.map((row) => row.task_id);
	} finally {
		db.close();
	}
}
