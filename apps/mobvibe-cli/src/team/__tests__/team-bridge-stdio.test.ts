import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_TEAM_TOOL_NAMES } from "../team-tool-handlers.js";
import {
	buildPerSessionTeamStdioBridge,
	buildTeamStdioBridgeToolManifest,
} from "../team-bridge-stdio.js";

describe("per-session stdio bridge fallback", () => {
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
});
