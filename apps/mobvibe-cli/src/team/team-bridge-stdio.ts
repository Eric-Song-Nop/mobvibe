import type { TeamMcpIdentityInput } from "./team-capability.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	type TeamToolName,
} from "./team-tool-handlers.js";

export type TeamStdioBridgeEnv = Array<{ name: string; value: string }>;

export type PerSessionTeamStdioBridgeDeclaration = {
	type: "stdio";
	name: "mobvibe-team";
	command: string;
	args: string[];
	env: TeamStdioBridgeEnv;
};

export type PerSessionTeamStdioBridgeInput = TeamMcpIdentityInput & {
	bridgeScriptPath: string;
	command?: string;
};

export type TeamStdioBridgeToolManifestEntry = {
	name: TeamToolName;
	inputKeys: string[];
};

const TEAM_STDIN_BRIDGE_NAME = "mobvibe-team";
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const toolInputKeys: Record<TeamToolName, string[]> = {
	mobvibe_team_send_message: ["to", "message", "summary"],
	mobvibe_team_members: [],
	mobvibe_team_task_create: ["title", "description", "owner", "blockedBy"],
	mobvibe_team_task_list: ["status", "owner"],
	mobvibe_team_task_update: [
		"taskId",
		"status",
		"owner",
		"blockedBy",
		"blocks",
	],
};

/**
 * Builds the stdio bridge fallback declaration for one team member session only.
 * The declaration carries routing ids in this session's process args/env and is
 * never persisted into agent-wide configuration.
 */
export function buildPerSessionTeamStdioBridge(
	input: PerSessionTeamStdioBridgeInput,
): PerSessionTeamStdioBridgeDeclaration {
	validateIdentityPart("agentTeamId", input.agentTeamId);
	validateIdentityPart("memberId", input.memberId);
	const scriptPath = input.bridgeScriptPath.trim();
	if (!scriptPath) {
		throw new Error("bridgeScriptPath is required for stdio bridge fallback");
	}

	return {
		type: "stdio",
		name: TEAM_STDIN_BRIDGE_NAME,
		command: input.command ?? process.execPath,
		args: [
			scriptPath,
			"--agent-team-id",
			input.agentTeamId,
			"--member-id",
			input.memberId,
		],
		env: [
			{ name: "MOBVIBE_TEAM_AGENT_TEAM_ID", value: input.agentTeamId },
			{ name: "MOBVIBE_TEAM_MEMBER_ID", value: input.memberId },
		],
	};
}

export function buildTeamStdioBridgeToolManifest(): TeamStdioBridgeToolManifestEntry[] {
	return EXPECTED_TEAM_TOOL_NAMES.map((name) => ({
		name,
		inputKeys: [...toolInputKeys[name]],
	}));
}

function validateIdentityPart(
	field: keyof TeamMcpIdentityInput,
	value: string,
): void {
	if (!value || !SAFE_ID_PATTERN.test(value)) {
		throw new Error(`${field} must be a non-empty safe identifier`);
	}
}
