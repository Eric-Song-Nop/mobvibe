import {
	type AgentSessionCapabilities,
	AppError,
	createErrorDetail,
	type TeamMcpTransport,
} from "@mobvibe/shared";
import { fileURLToPath } from "node:url";
import {
	buildPerSessionTeamStdioBridge,
	type PerSessionTeamStdioBridgeDeclaration,
} from "./team-bridge-stdio.js";

const TEAM_MCP_SERVER_NAME = "mobvibe-team";
const TEAM_MCP_SERVER_ID_PREFIX = "mobvibe-team";
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export type TeamMcpIdentityInput = {
	agentTeamId: string;
	memberId: string;
};

export type TeamAcpMcpDeclaration = {
	type: "acp";
	name: "mobvibe-team";
	id: string;
};

export type TeamMcpSessionDeclaration =
	| TeamAcpMcpDeclaration
	| PerSessionTeamStdioBridgeDeclaration;

export type TeamMcpSessionSelection = {
	transport: TeamMcpTransport;
	declaration: TeamMcpSessionDeclaration;
};

const createCapabilityNotSupportedError = () =>
	new AppError(
		createErrorDetail({
			code: "CAPABILITY_NOT_SUPPORTED",
			message:
				"Backend does not support native MCP-over-ACP or safe per-session bridge",
			retryable: false,
			scope: "session",
		}),
		409,
	);

const createInvalidIdentityError = (field: keyof TeamMcpIdentityInput) =>
	new AppError(
		createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message: `${field} must be a non-empty safe identifier`,
			retryable: false,
			scope: "request",
		}),
		400,
	);

const validateIdentityPart = (
	field: keyof TeamMcpIdentityInput,
	value: string,
) => {
	if (!value || !SAFE_ID_PATTERN.test(value)) {
		throw createInvalidIdentityError(field);
	}
};

export const buildTeamMcpServerId = (input: TeamMcpIdentityInput): string => {
	validateIdentityPart("agentTeamId", input.agentTeamId);
	validateIdentityPart("memberId", input.memberId);
	return `${TEAM_MCP_SERVER_ID_PREFIX}:${input.agentTeamId}:${input.memberId}`;
};

export const buildTeamMcpDeclaration = (
	input: TeamMcpIdentityInput,
): TeamAcpMcpDeclaration => ({
	type: "acp",
	name: TEAM_MCP_SERVER_NAME,
	id: buildTeamMcpServerId(input),
});

export const resolveTeamMcpTransport = (
	capabilities: AgentSessionCapabilities,
): TeamMcpTransport => {
	if (capabilities.mcp?.acp === true) {
		return "acp";
	}
	if (
		capabilities.mcp?.stdio === true &&
		capabilities.mcp.perSessionBridge === true
	) {
		return "stdio_bridge";
	}
	throw createCapabilityNotSupportedError();
};

export const buildTeamMcpSessionSelection = (input: {
	capabilities: AgentSessionCapabilities;
	agentTeamId: string;
	memberId: string;
	bridgeScriptPath?: string;
}): TeamMcpSessionSelection => {
	const transport = resolveTeamMcpTransport(input.capabilities);
	if (transport === "acp") {
		return {
			transport,
			declaration: buildTeamMcpDeclaration(input),
		};
	}
	if (transport === "stdio_bridge") {
		return {
			transport,
			declaration: buildPerSessionTeamStdioBridge({
				agentTeamId: input.agentTeamId,
				memberId: input.memberId,
				bridgeScriptPath:
					input.bridgeScriptPath ??
					fileURLToPath(new URL("./team-bridge-stdio.js", import.meta.url)),
			}),
		};
	}
	throw createCapabilityNotSupportedError();
};
