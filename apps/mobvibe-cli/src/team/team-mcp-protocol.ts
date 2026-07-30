import { randomUUID } from "node:crypto";
import {
	type ClientApp,
	type ConnectMcpRequest,
	type ConnectMcpResponse,
	type DisconnectMcpRequest,
	type DisconnectMcpResponse,
	type MessageMcpNotification,
	type MessageMcpRequest,
	type MessageMcpResponse,
	RequestError,
} from "@agentclientprotocol/sdk";
import type { TeamMcpTransport } from "@mobvibe/shared";
import type { TeamAcpMcpDeclaration } from "./team-capability.js";
import {
	EXPECTED_TEAM_TOOL_NAMES,
	type TeamToolName,
} from "./team-tool-handlers.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

export type TeamMcpProtocolHandlers = {
	handleConnect(input: {
		serverId: string;
		transport?: TeamMcpTransport;
	}): unknown;
	handleListTools(input: { serverId: string; toolNames: string[] }): unknown;
	handleToolCall(input: {
		serverId: string;
		toolName: TeamToolName;
		args: unknown;
	}): Promise<unknown> | unknown;
	handleDisconnect(input: { serverId: string }): unknown;
};

export type TeamMcpProtocolConfiguration = {
	declaration: TeamAcpMcpDeclaration;
	handlers: TeamMcpProtocolHandlers;
};

type ToolDescriptor = {
	name: TeamToolName;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
		additionalProperties: boolean;
	};
};

const stringProperty = (description: string) => ({
	type: "string",
	description,
});

const stringArrayProperty = (description: string) => ({
	type: "array",
	items: { type: "string" },
	description,
});

export const TEAM_MCP_TOOLS: readonly ToolDescriptor[] = [
	{
		name: "mobvibe_team_send_message",
		description: "Send a durable message to one teammate or broadcast target.",
		inputSchema: {
			type: "object",
			properties: {
				to: stringProperty("Member id, member name, or broadcast."),
				message: stringProperty("Message content."),
				summary: stringProperty("Optional short delivery summary."),
			},
			required: ["to", "message"],
			additionalProperties: false,
		},
	},
	{
		name: "mobvibe_team_members",
		description: "List members of the current Agent Team.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "mobvibe_team_spawn_member",
		description: "Start another ordinary ACP agent as a Team member.",
		inputSchema: {
			type: "object",
			properties: {
				name: stringProperty("Optional display name."),
				backendId: stringProperty("Optional ACP backend id."),
			},
			additionalProperties: false,
		},
	},
	{
		name: "mobvibe_team_task_create",
		description: "Create a durable task on the Team task board.",
		inputSchema: {
			type: "object",
			properties: {
				title: stringProperty("Task title."),
				description: stringProperty("Optional task details."),
				owner: stringProperty("Optional member id or name."),
				status: stringProperty("Optional task status."),
				blockedBy: stringArrayProperty("Task ids blocking this task."),
			},
			required: ["title"],
			additionalProperties: false,
		},
	},
	{
		name: "mobvibe_team_task_list",
		description: "List tasks on the current Team task board.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "mobvibe_team_task_update",
		description: "Update a durable task on the Team task board.",
		inputSchema: {
			type: "object",
			properties: {
				taskId: stringProperty("Task id."),
				status: stringProperty("Optional task status."),
				owner: stringProperty("Optional member id or name."),
				title: stringProperty("Optional replacement title."),
				description: stringProperty("Optional replacement details."),
				blockedBy: stringArrayProperty("Replacement blocking task ids."),
			},
			required: ["taskId"],
			additionalProperties: false,
		},
	},
] as const;

export class TeamMcpProtocolAdapter {
	private configuration?: TeamMcpProtocolConfiguration;
	private readonly serverIdByConnectionId = new Map<string, string>();

	configure(configuration?: TeamMcpProtocolConfiguration): void {
		this.disconnectAll();
		this.configuration = configuration;
	}

	connect(params: ConnectMcpRequest): ConnectMcpResponse {
		const configuration = this.requireConfiguration("mcp/connect");
		if (params.serverId !== configuration.declaration.serverId) {
			throw RequestError.invalidParams(
				{ serverId: params.serverId },
				"Team MCP server id does not match the active session declaration",
			);
		}
		configuration.handlers.handleConnect({
			serverId: params.serverId,
			transport: "acp",
		});
		const connectionId = randomUUID();
		this.serverIdByConnectionId.set(connectionId, params.serverId);
		return { connectionId };
	}

	async message(params: MessageMcpRequest): Promise<MessageMcpResponse> {
		const { configuration, serverId } = this.requireConnection(
			params.connectionId,
		);
		switch (params.method) {
			case "initialize":
				return {
					protocolVersion: readProtocolVersion(params.params),
					capabilities: { tools: {} },
					serverInfo: { name: "mobvibe-team", version: "1.0.0" },
				};
			case "ping":
				return {};
			case "tools/list":
				configuration.handlers.handleListTools({
					serverId,
					toolNames: [...EXPECTED_TEAM_TOOL_NAMES],
				});
				return { tools: TEAM_MCP_TOOLS };
			case "tools/call": {
				const call = parseToolCall(params.params);
				const result = await configuration.handlers.handleToolCall({
					serverId,
					toolName: call.name,
					args: call.arguments,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result) }],
					structuredContent: result,
				};
			}
			default:
				throw RequestError.methodNotFound(params.method);
		}
	}

	async notification(params: MessageMcpNotification): Promise<void> {
		this.requireConnection(params.connectionId);
		if (params.method === "notifications/initialized") {
			return;
		}
		throw RequestError.methodNotFound(params.method);
	}

	disconnect(params: DisconnectMcpRequest): DisconnectMcpResponse {
		const { configuration, serverId } = this.requireConnection(
			params.connectionId,
		);
		this.serverIdByConnectionId.delete(params.connectionId);
		configuration.handlers.handleDisconnect({ serverId });
		return {};
	}

	private requireConfiguration(method: string): TeamMcpProtocolConfiguration {
		if (!this.configuration) {
			throw RequestError.methodNotFound(method);
		}
		return this.configuration;
	}

	private requireConnection(connectionId: string): {
		configuration: TeamMcpProtocolConfiguration;
		serverId: string;
	} {
		const configuration = this.requireConfiguration("mcp/message");
		const serverId = this.serverIdByConnectionId.get(connectionId);
		if (!serverId) {
			throw RequestError.invalidParams(
				{ connectionId },
				"Team MCP connection is not active",
			);
		}
		return { configuration, serverId };
	}

	private disconnectAll(): void {
		const configuration = this.configuration;
		const serverIds = new Set(this.serverIdByConnectionId.values());
		this.serverIdByConnectionId.clear();
		if (!configuration) return;
		for (const serverId of serverIds) {
			configuration.handlers.handleDisconnect({ serverId });
		}
	}
}

export const registerTeamMcpProtocolHandlers = (
	app: ClientApp,
	adapter: TeamMcpProtocolAdapter,
): ClientApp =>
	app
		.onRequest("mcp/connect", parseConnectMcpRequest, ({ params }) =>
			adapter.connect(params),
		)
		.onRequest("mcp/message", parseMessageMcpRequest, ({ params }) =>
			adapter.message(params),
		)
		.onNotification("mcp/message", parseMessageMcpNotification, ({ params }) =>
			adapter.notification(params),
		)
		.onRequest("mcp/disconnect", parseDisconnectMcpRequest, ({ params }) =>
			adapter.disconnect(params),
		);

export const parseConnectMcpRequest = (value: unknown): ConnectMcpRequest => {
	const params = requireRecord(value, "mcp/connect params");
	if (typeof params.serverId !== "string" || !params.serverId) {
		throw RequestError.invalidParams(
			undefined,
			"mcp/connect.serverId must be a non-empty string",
		);
	}
	return { serverId: params.serverId };
};

export const parseMessageMcpRequest = (value: unknown): MessageMcpRequest => {
	const params = requireRecord(value, "mcp/message params");
	if (typeof params.connectionId !== "string" || !params.connectionId) {
		throw RequestError.invalidParams(
			undefined,
			"mcp/message.connectionId must be a non-empty string",
		);
	}
	if (typeof params.method !== "string" || !params.method) {
		throw RequestError.invalidParams(
			undefined,
			"mcp/message.method must be a non-empty string",
		);
	}
	const innerParams =
		params.params === undefined || params.params === null
			? undefined
			: requireRecord(params.params, "mcp/message inner params");
	return {
		connectionId: params.connectionId,
		method: params.method,
		...(innerParams ? { params: innerParams } : {}),
	};
};

export const parseMessageMcpNotification = (
	value: unknown,
): MessageMcpNotification => parseMessageMcpRequest(value);

export const parseDisconnectMcpRequest = (
	value: unknown,
): DisconnectMcpRequest => {
	const params = requireRecord(value, "mcp/disconnect params");
	if (typeof params.connectionId !== "string" || !params.connectionId) {
		throw RequestError.invalidParams(
			undefined,
			"mcp/disconnect.connectionId must be a non-empty string",
		);
	}
	return { connectionId: params.connectionId };
};

function readProtocolVersion(
	params: Record<string, unknown> | null | undefined,
): string {
	return typeof params?.protocolVersion === "string"
		? params.protocolVersion
		: MCP_PROTOCOL_VERSION;
}

function parseToolCall(params: Record<string, unknown> | null | undefined): {
	name: TeamToolName;
	arguments: Record<string, unknown>;
} {
	const record = requireRecord(params, "tools/call params");
	if (
		typeof record.name !== "string" ||
		!EXPECTED_TEAM_TOOL_NAMES.includes(record.name as TeamToolName)
	) {
		throw RequestError.invalidParams(
			{ name: record.name },
			"Unknown Mobvibe Team tool",
		);
	}
	const args =
		record.arguments === undefined || record.arguments === null
			? {}
			: requireRecord(record.arguments, "tools/call arguments");
	return { name: record.name as TeamToolName, arguments: args };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw RequestError.invalidParams(undefined, `${label} must be an object`);
	}
	return value as Record<string, unknown>;
}
