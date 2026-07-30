import { describe, expect, mock, test } from "bun:test";
import {
	TeamMcpProtocolAdapter,
	type TeamMcpProtocolHandlers,
} from "../team-mcp-protocol.js";
import { EXPECTED_TEAM_TOOL_NAMES } from "../team-tool-handlers.js";

const declaration = {
	type: "acp" as const,
	name: "mobvibe-team" as const,
	serverId: "mobvibe-team:team-1:member-1",
};

const createHandlers = (): TeamMcpProtocolHandlers => ({
	handleConnect: mock(() => {}),
	handleListTools: mock(() => {}),
	handleToolCall: mock((input) =>
		Promise.resolve({
			caller: {
				agentTeamId: "team-1",
				memberId: "member-1",
				role: "leader" as const,
			},
			toolName: input.toolName,
			data: { ok: true },
		}),
	),
	handleDisconnect: mock(() => {}),
});

describe("TeamMcpProtocolAdapter", () => {
	test("binds an ACP server id to an opaque connection id", () => {
		const handlers = createHandlers();
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers });

		const result = adapter.connect({ serverId: declaration.serverId });

		expect(result.connectionId).toBeString();
		expect(result.connectionId).not.toBe(declaration.serverId);
		expect(handlers.handleConnect).toHaveBeenCalledWith({
			serverId: declaration.serverId,
			transport: "acp",
		});
		expect(() =>
			adapter.connect({ serverId: "mobvibe-team:team-1:member-other" }),
		).toThrow("does not match");
	});

	test("implements MCP initialize, tools/list, tools/call, and disconnect", async () => {
		const handlers = createHandlers();
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers });
		const { connectionId } = adapter.connect({
			serverId: declaration.serverId,
		});

		const initialized = await adapter.message({
			connectionId,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "agent", version: "1.0.0" },
			},
		});
		expect(initialized).toEqual(
			expect.objectContaining({
				protocolVersion: "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: expect.objectContaining({ name: "mobvibe-team" }),
			}),
		);

		await adapter.notification({
			connectionId,
			method: "notifications/initialized",
		});
		const listed = await adapter.message({
			connectionId,
			method: "tools/list",
		});
		expect(listed).toEqual({
			tools: expect.arrayContaining(
				EXPECTED_TEAM_TOOL_NAMES.map((name) =>
					expect.objectContaining({ name }),
				),
			),
		});
		expect(handlers.handleListTools).toHaveBeenCalledWith({
			serverId: declaration.serverId,
			toolNames: [...EXPECTED_TEAM_TOOL_NAMES],
		});

		const called = await adapter.message({
			connectionId,
			method: "tools/call",
			params: {
				name: "mobvibe_team_members",
				arguments: { ignoredIdentity: "member-other" },
			},
		});
		expect(handlers.handleToolCall).toHaveBeenCalledWith({
			serverId: declaration.serverId,
			toolName: "mobvibe_team_members",
			args: { ignoredIdentity: "member-other" },
		});
		expect(called).toEqual({
			content: [
				{
					type: "text",
					text: expect.stringContaining('"ok":true'),
				},
			],
			structuredContent: expect.objectContaining({
				toolName: "mobvibe_team_members",
			}),
		});

		expect(adapter.disconnect({ connectionId })).toEqual({});
		expect(handlers.handleDisconnect).toHaveBeenCalledWith({
			serverId: declaration.serverId,
		});
		expect(() => adapter.disconnect({ connectionId })).toThrow(
			"connection is not active",
		);
	});

	test("does not route stale connection ids after session reconfiguration", async () => {
		const handlers = createHandlers();
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers });
		const { connectionId } = adapter.connect({
			serverId: declaration.serverId,
		});

		adapter.configure({
			declaration: {
				...declaration,
				serverId: "mobvibe-team:team-2:member-2",
			},
			handlers,
		});

		await expect(
			adapter.message({ connectionId, method: "tools/list" }),
		).rejects.toThrow("connection is not active");
		expect(handlers.handleDisconnect).toHaveBeenCalledWith({
			serverId: declaration.serverId,
		});
	});
});
