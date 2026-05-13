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
	let store: AgentTeamStore;
	let agentTeamId: string;
	let leaderMemberId: string;
	let memberId: string;
	let router: TeamMcpRouter;
	let createSession: ReturnType<typeof mock>;
	let renameSession: ReturnType<typeof mock>;
	let shutdownSession: ReturnType<typeof mock>;
	let requestPermission: ReturnType<typeof mock>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-mcp-router-"));
		store = new AgentTeamStore(path.join(tempDir, "events.db"));
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
		const handlers = new TeamToolHandlers({
			store,
			requestPermission,
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

		router.handleListTools({ serverId, toolNames: [...EXPECTED_TEAM_TOOL_NAMES] });

		const team = store.getAgentTeam({ agentTeamId }).team;
		expect(team?.members[0].mcp?.phase).toBe("tools_ready");
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

	test("leader and non-leader can dispatch every registered team tool without confirmation", async () => {
		const leaderServerId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
		const memberServerId = `mobvibe-team:${agentTeamId}:${memberId}`;
		router.handleConnect({ serverId: leaderServerId });
		router.handleConnect({ serverId: memberServerId });

		for (const serverId of [leaderServerId, memberServerId]) {
			for (const toolName of EXPECTED_TEAM_TOOL_NAMES) {
				await router.handleToolCall({ serverId, toolName, args: {} });
			}
		}

		expect(requestPermission).not.toHaveBeenCalled();
	});
});
