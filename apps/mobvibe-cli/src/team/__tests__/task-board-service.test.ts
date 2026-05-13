import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentTeamStore } from "../agent-team-store.js";
import { TaskBoardService } from "../task-board-service.js";
import type { TeamToolCaller } from "../team-tool-handlers.js";

describe("TaskBoardService durable task graph", () => {
	let tempDir: string;
	let dbPath: string;
	let store: AgentTeamStore;
	let service: TaskBoardService;
	let agentTeamId: string;
	let leaderMemberId: string;
	let workerMemberId: string;
	let caller: TeamToolCaller;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-board-service-"));
		dbPath = path.join(tempDir, "events.db");
		store = new AgentTeamStore(dbPath);
		service = new TaskBoardService(store);
		const team = store.createAgentTeam({
			machineId: "machine-1",
			backendId: "backend-1",
			workspaceRootCwd: "/workspace",
			title: "Task Team",
			leaderName: "Leader",
		}).team;
		agentTeamId = team.agentTeamId;
		leaderMemberId = team.leaderMemberId;
		workerMemberId = store.addTeamMember({
			agentTeamId,
			backendId: "backend-2",
			name: "Worker",
			role: "member",
		}).memberId;
		caller = { agentTeamId, memberId: leaderMemberId, role: "leader" };
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("creates an unblocked task with todo status and local body only", () => {
		const task = service.createTask(caller, {
			title: "Write tests",
			description: "Pin task behavior",
			owner: "Worker",
		});

		expect(task.status).toBe("todo");
		expect(task.ownerMemberId).toBe(workerMemberId);
		expect(task.ownerName).toBe("Worker");
		expect(task.blockedBy).toEqual([]);
		expect(task.blocks).toEqual([]);

		const row = readTaskRows(dbPath)[0];
		expect(row.owner_member_id).toBe(workerMemberId);
		expect(row.status).toBe("todo");
		expect(JSON.parse(row.body_local_json)).toEqual({
			title: "Write tests",
			description: "Pin task behavior",
		});
		expect(JSON.parse(row.blocks_json)).toEqual([]);
	});

	test("creates a blocked task and appends its id to upstream blocks", () => {
		const upstream = service.createTask(caller, { title: "Design API" });
		const downstream = service.createTask(caller, {
			title: "Implement API",
			blockedBy: [upstream.taskId],
		});

		expect(downstream.status).toBe("blocked");
		expect(downstream.blockedBy).toEqual([upstream.taskId]);
		expect(service.listTasks(caller)[0].blocks).toEqual([downstream.taskId]);
	});

	test("completing an upstream task unblocks downstream tasks", () => {
		const upstream = service.createTask(caller, { title: "Design API" });
		const downstream = service.createTask(caller, {
			title: "Implement API",
			blockedBy: [upstream.taskId],
		});

		service.updateTask(caller, { taskId: upstream.taskId, status: "completed" });

		const tasks = service.listTasks(caller);
		expect(tasks.find((task) => task.taskId === upstream.taskId)?.blocks).toEqual(
			[],
		);
		expect(tasks.find((task) => task.taskId === downstream.taskId)).toEqual(
			expect.objectContaining({ status: "todo", blockedBy: [] }),
		);
	});

	test("rejects AionUI-only pending and deleted statuses", () => {
		expect(() =>
			service.createTask(caller, { title: "Bad", status: "pending" }),
		).toThrow("Invalid task status");
		const task = service.createTask(caller, { title: "Valid" });
		expect(() =>
			service.updateTask(caller, { taskId: task.taskId, status: "deleted" }),
		).toThrow("Invalid task status");
	});

	test("Gateway projection excludes task title, description, body, and body_local_json", () => {
		service.createTask(caller, {
			title: "Secret local title",
			description: "Secret local description",
		});

		const projected = store.getAgentTeam({ agentTeamId }).team;
		const serialized = JSON.stringify(projected);
		expect(projected?.taskCounts.todo).toBe(1);
		expect(serialized).not.toContain("Secret local title");
		expect(serialized).not.toContain("Secret local description");
		expect(serialized).not.toContain("body_local_json");
		expect(serialized).not.toContain("body");
	});
});

type TaskRow = {
	owner_member_id: string | null;
	status: string;
	body_local_json: string;
	blocks_json: string;
};

function readTaskRows(dbPath: string): TaskRow[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.query(
				"SELECT owner_member_id, status, body_local_json, blocks_json FROM agent_team_tasks ORDER BY created_at ASC",
			)
			.all() as TaskRow[];
	} finally {
		db.close();
	}
}
