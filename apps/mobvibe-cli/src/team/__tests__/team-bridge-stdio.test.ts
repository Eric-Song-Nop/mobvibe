import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentTeamStore } from "../agent-team-store.js";
import {
	buildPerSessionTeamStdioBridge,
	buildTeamStdioBridgeToolManifest,
} from "../team-bridge-stdio.js";
import { TeamMcpRouter } from "../team-mcp-router.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	TeamToolHandlers,
} from "../team-tool-handlers.js";

describe("per-session stdio bridge fallback", () => {
	let tempDir: string;
	let store: AgentTeamStore;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-stdio-bridge-"));
		store = new AgentTeamStore(path.join(tempDir, "events.db"));
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("builds a single-session mobvibe-team stdio declaration", () => {
		const declaration = buildPerSessionTeamStdioBridge({
			agentTeamId: "team-123",
			memberId: "member-456",
			bridgeScriptPath: "/opt/mobvibe/team-bridge-stdio.mjs",
		});

		expect(declaration).toEqual({
			type: "stdio",
			name: "mobvibe-team",
			command: process.execPath,
			args: [
				"/opt/mobvibe/team-bridge-stdio.mjs",
				"--agent-team-id",
				"team-123",
				"--member-id",
				"member-456",
			],
			env: [
				{ name: "MOBVIBE_TEAM_AGENT_TEAM_ID", value: "team-123" },
				{ name: "MOBVIBE_TEAM_MEMBER_ID", value: "member-456" },
			],
		});
	});

	test("bridge manifest registers the native mobvibe team tool names", () => {
		const toolNames = buildTeamStdioBridgeToolManifest().map(
			(tool) => tool.name,
		);

		expect(toolNames).toEqual([...EXPECTED_TEAM_TOOL_NAMES]);
	});

	test("bridge manifest matches the durable task tool argument surface", () => {
		const manifest = new Map(
			buildTeamStdioBridgeToolManifest().map((tool) => [
				tool.name,
				tool.inputKeys,
			]),
		);

		expect(manifest.get("mobvibe_team_task_create")).toEqual([
			"title",
			"description",
			"owner",
			"status",
			"blockedBy",
		]);
		expect(manifest.get("mobvibe_team_task_list")).toEqual([]);
		expect(manifest.get("mobvibe_team_task_update")).toEqual([
			"taskId",
			"status",
			"owner",
			"title",
			"description",
			"blockedBy",
		]);
		expect(manifest.get("mobvibe_team_spawn_member")).toEqual([
			"name",
			"backendId",
		]);
		expect(manifest.get("mobvibe_team_spawn_member")).not.toContain("prompt");
		expect(manifest.get("mobvibe_team_spawn_member")).not.toContain("body");
		expect(manifest.get("mobvibe_team_spawn_member")).not.toContain("worktree");
		expect(manifest.get("mobvibe_team_task_update")).not.toContain("blocks");
	});

	test("source does not write global MCP configuration or use primary TCP bridge", () => {
		const sourcePath = path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"..",
			"team-bridge-stdio.ts",
		);
		const source = fs.readFileSync(sourcePath, "utf8");

		expect(source).not.toContain("settings.json");
		expect(source).not.toContain(".mcp");
		expect(source).not.toContain("TEAM_MCP_PORT");
		expect(source).not.toContain("writeFile");
	});

	test("stdio bridge readiness persists stdio_bridge transport and tool phase", () => {
		const created = store.createAgentTeam({
			machineId: "machine-1",
			workspaceRootCwd: "/workspace",
			backendId: "backend-1",
			title: "Bridge Team",
			leaderName: "Leader",
		});
		const agentTeamId = created.team.agentTeamId;
		const memberId = created.team.leaderMemberId;
		const router = new TeamMcpRouter({
			store,
			handlers: new TeamToolHandlers({ store }),
		});
		const serverId = `mobvibe-team:${agentTeamId}:${memberId}`;

		router.handleConnect({ serverId, transport: "stdio_bridge" });
		router.handleListTools({
			serverId,
			toolNames: [...EXPECTED_TEAM_TOOL_NAMES],
		});

		const team = store.getAgentTeam({ agentTeamId }).team;
		expect(team?.members[0].mcp?.transport).toBe("stdio_bridge");
		expect(team?.members[0].mcp?.phase).toBe("tools_ready");
	});
});
