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

const initializeConnection = async (
	adapter: TeamMcpProtocolAdapter,
	connectionId: string,
) => {
	await adapter.message({
		connectionId,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "agent", version: "1.0.0" },
		},
	});
	await adapter.notification({
		connectionId,
		method: "notifications/initialized",
	});
};

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

	test("rejects tool requests until the MCP initialization handshake completes", async () => {
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers: createHandlers() });
		const { connectionId } = adapter.connect({
			serverId: declaration.serverId,
		});

		await expect(
			adapter.message({ connectionId, method: "tools/list" }),
		).rejects.toThrow("initialization handshake");
		await expect(
			adapter.message({
				connectionId,
				method: "tools/call",
				params: { name: "mobvibe_team_members", arguments: {} },
			}),
		).rejects.toThrow("initialization handshake");

		await adapter.message({
			connectionId,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "agent", version: "1.0.0" },
			},
		});

		await expect(
			adapter.message({ connectionId, method: "tools/list" }),
		).rejects.toThrow("initialization handshake");

		await adapter.notification({
			connectionId,
			method: "notifications/initialized",
		});
		await expect(
			adapter.message({ connectionId, method: "tools/list" }),
		).resolves.toEqual({
			tools: expect.arrayContaining([
				expect.objectContaining({ name: "mobvibe_team_members" }),
			]),
		});
	});

	test("rejects missing or malformed initialize params without advancing state", async () => {
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers: createHandlers() });
		const { connectionId } = adapter.connect({
			serverId: declaration.serverId,
		});

		for (const params of [
			undefined,
			{},
			{
				protocolVersion: "",
				capabilities: {},
				clientInfo: { name: "agent", version: "1.0.0" },
			},
			{
				protocolVersion: "2025-06-18",
				capabilities: "tools",
				clientInfo: { name: "agent", version: "1.0.0" },
			},
			{
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "agent" },
			},
		]) {
			await expect(
				adapter.message({
					connectionId,
					method: "initialize",
					...(params === undefined ? {} : { params }),
				}),
			).rejects.toThrow("initialize");
		}

		await initializeConnection(adapter, connectionId);
	});

	test("negotiates an unsupported client protocol version to the supported version", async () => {
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers: createHandlers() });
		const { connectionId } = adapter.connect({
			serverId: declaration.serverId,
		});

		const initialized = await adapter.message({
			connectionId,
			method: "initialize",
			params: {
				protocolVersion: "2099-01-01",
				capabilities: {},
				clientInfo: { name: "future-agent", version: "1.0.0" },
			},
		});

		expect(initialized).toEqual(
			expect.objectContaining({ protocolVersion: "2025-06-18" }),
		);
	});

	test("marks structured Team tool failures as MCP execution errors", async () => {
		const handlers: TeamMcpProtocolHandlers = {
			...createHandlers(),
			handleToolCall: mock((input) =>
				Promise.resolve({
					caller: {
						agentTeamId: "team-1",
						memberId: "member-1",
						role: "leader" as const,
					},
					toolName: input.toolName,
					data: {
						ok: false,
						error: { code: "REQUEST_VALIDATION_FAILED" },
					},
				}),
			),
		};
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers });
		const { connectionId } = adapter.connect({
			serverId: declaration.serverId,
		});
		await initializeConnection(adapter, connectionId);

		const result = await adapter.message({
			connectionId,
			method: "tools/call",
			params: {
				name: "mobvibe_team_send_message",
				arguments: { to: "Missing", message: "hello" },
			},
		});

		expect(result).toEqual(
			expect.objectContaining({
				isError: true,
				structuredContent: expect.objectContaining({
					data: expect.objectContaining({ ok: false }),
				}),
			}),
		);
	});

	test("disconnects every active connection during reconfiguration", () => {
		const handlers = createHandlers();
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({ declaration, handlers });
		adapter.connect({ serverId: declaration.serverId });
		adapter.connect({ serverId: declaration.serverId });

		adapter.configure(undefined);

		expect(handlers.handleDisconnect).toHaveBeenCalledTimes(2);
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
