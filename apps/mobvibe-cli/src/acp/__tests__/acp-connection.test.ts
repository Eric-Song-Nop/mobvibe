import { beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mock the SDK
mock.module("@agentclientprotocol/sdk", () => ({
	ClientSideConnection: mock(() => {}),
	ndJsonStream: mock(() => {}),
	PROTOCOL_VERSION: "0.1.0",
}));

// Mock child_process wrapper so other tests can safely mock node:child_process
mock.module("../../lib/child-process.js", () => ({
	spawn: mock(() => ({
		stdin: { pipe: mock(() => {}) },
		stdout: { pipe: mock(() => {}) },
		stderr: { pipe: mock(() => {}) },
		on: mock(() => {}),
		once: mock(() => {}),
		kill: mock(() => {}),
		exitCode: null,
		killed: false,
		pid: 12345,
	})),
}));

// Mock stream
mock.module("node:stream", () => ({
	Readable: { toWeb: mock(() => ({})) },
	Writable: { toWeb: mock(() => ({})) },
}));

import type { AcpBackendConfig } from "../../config.js";
import { AgentTeamStore } from "../../team/agent-team-store.js";
import { buildTeamMcpDeclaration } from "../../team/team-capability.js";
import { TeamRuntime } from "../../team/team-runtime.js";
import { EXPECTED_TEAM_TOOL_NAMES } from "../../team/team-tool-handlers.js";
import { AcpConnection } from "../acp-connection.js";

const createMockBackendConfig = (): AcpBackendConfig => ({
	id: "test-backend",
	label: "Test Backend",
	command: "test-command",
	args: ["--arg1"],
});

describe("AcpConnection", () => {
	let connection: AcpConnection;
	let mockBackend: AcpBackendConfig;

	beforeEach(() => {
		mockBackend = createMockBackendConfig();
		connection = new AcpConnection({
			backend: mockBackend,
			client: { name: "test-client", version: "1.0.0" },
		});
	});

	describe("getSessionCapabilities", () => {
		it("returns all false when agentCapabilities is undefined", () => {
			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(false);
			expect(capabilities.load).toBe(false);
			expect(capabilities.prompt).toEqual({
				audio: false,
				embeddedContext: false,
				image: false,
			});
		});

		it("returns correct capabilities when sessionCapabilities.list is defined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: {},
				},
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(true);
			expect(capabilities.load).toBe(false);
			expect(capabilities.prompt?.image).toBe(false);
		});

		it("returns correct capabilities when loadSession is true", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: true,
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.list).toBe(false);
			expect(capabilities.load).toBe(true);
			expect(capabilities.prompt?.image).toBe(false);
		});

		it("maps prompt capabilities from agent initialize response", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				promptCapabilities: {
					image: true,
					audio: false,
					embeddedContext: true,
				},
			};

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.prompt).toEqual({
				image: true,
				audio: false,
				embeddedContext: true,
			});
		});

		it("maps native and bridge MCP capabilities behind Mobvibe-owned narrow fields", () => {
			const capabilitiesWithRfdMcp = {
				mcpCapabilities: {
					acp: true,
					stdio: true,
					perSessionBridge: true,
				},
			} as unknown;
			// @ts-expect-error - accessing private property for testing an RFD-only SDK extension
			connection.agentCapabilities = capabilitiesWithRfdMcp;

			const capabilities = connection.getSessionCapabilities();

			expect(capabilities.mcp).toEqual({
				acp: true,
				stdio: true,
				perSessionBridge: true,
			});
		});
	});

	describe("SDK MCP-over-ACP probe", () => {
		it("records that SDK 0.21.x still requires the local acp adapter boundary", () => {
			const packageJson = JSON.parse(
				fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
			) as { dependencies?: Record<string, string> };
			const sdkSchemaPath = fileURLToPath(
				import.meta.resolve("@agentclientprotocol/sdk/schema/schema.json"),
			);
			const schema = JSON.parse(fs.readFileSync(sdkSchemaPath, "utf8")) as {
				$defs?: Record<string, unknown>;
			};
			const mcpServer = schema.$defs?.McpServer;
			const serializedMcpServer = JSON.stringify(mcpServer);

			expect(packageJson.dependencies?.["@agentclientprotocol/sdk"]).toBe(
				"^0.21.0",
			);
			expect(serializedMcpServer).not.toContain('"const":"acp"');
		});
	});

	describe("supportsSessionList", () => {
		it("returns false when agentCapabilities is undefined", () => {
			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns false when sessionCapabilities is undefined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {};

			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns false when sessionCapabilities.list is null", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: null,
				},
			};

			expect(connection.supportsSessionList()).toBe(false);
		});

		it("returns true when sessionCapabilities.list is defined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				sessionCapabilities: {
					list: {},
				},
			};

			expect(connection.supportsSessionList()).toBe(true);
		});
	});

	describe("supportsSessionLoad", () => {
		it("returns false when agentCapabilities is undefined", () => {
			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns false when loadSession is false", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: false,
			};

			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns false when loadSession is undefined", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {};

			expect(connection.supportsSessionLoad()).toBe(false);
		});

		it("returns true when loadSession is true", () => {
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = {
				loadSession: true,
			};

			expect(connection.supportsSessionLoad()).toBe(true);
		});
	});

	describe("listSessions", () => {
		it("returns empty array when session list not supported", async () => {
			// agentCapabilities is undefined, so supportsSessionList() returns false
			const result = await connection.listSessions();

			expect(result).toEqual({ sessions: [] });
		});
	});

	describe("loadSession", () => {
		it("throws error when session load not supported", async () => {
			// agentCapabilities is undefined, so supportsSessionLoad() returns false
			await expect(
				connection.loadSession("session-1", "/home/user/project"),
			).rejects.toThrow("Agent does not support session/load capability");
		});

		it("passes an empty mcpServers array for ordinary non-team session/load", async () => {
			const loadSession = mock(() =>
				Promise.resolve({ modes: null, models: null }),
			);
			// @ts-expect-error - accessing private properties to test ordinary ACP payload isolation
			connection.state = "ready";
			// @ts-expect-error - accessing private properties to test ordinary ACP payload isolation
			connection.connection = { loadSession };
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = { loadSession: true };

			await connection.loadSession("session-1", "/home/user/project");

			expect(loadSession).toHaveBeenCalledWith({
				sessionId: "session-1",
				cwd: "/home/user/project",
				mcpServers: [],
			});
		});

		it("passes a single team MCP declaration for team session/load", async () => {
			const loadSession = mock(() =>
				Promise.resolve({ modes: null, models: null }),
			);
			// @ts-expect-error - accessing private properties to test team ACP payload isolation
			connection.state = "ready";
			// @ts-expect-error - accessing private properties to test team ACP payload isolation
			connection.connection = { loadSession };
			// @ts-expect-error - accessing private property for testing
			connection.agentCapabilities = { loadSession: true };
			const declaration = buildTeamMcpDeclaration({
				agentTeamId: "team-1",
				memberId: "member-1",
			});

			await connection.loadSession("session-1", "/home/user/project", {
				teamMcpDeclaration: declaration,
			});

			expect(loadSession).toHaveBeenCalledWith({
				sessionId: "session-1",
				cwd: "/home/user/project",
				mcpServers: [declaration],
			});
		});
	});

	describe("createSession", () => {
		it("passes an empty mcpServers array for ordinary non-team session/new", async () => {
			const newSession = mock(() =>
				Promise.resolve({ sessionId: "session-1", modes: null, models: null }),
			);
			// @ts-expect-error - accessing private properties to test ordinary ACP payload isolation
			connection.state = "ready";
			// @ts-expect-error - accessing private properties to test ordinary ACP payload isolation
			connection.connection = { newSession };

			await connection.createSession({ cwd: "/home/user/project" });

			expect(newSession).toHaveBeenCalledWith({
				cwd: "/home/user/project",
				mcpServers: [],
			});
		});

		it("passes a single team MCP declaration for team session/new", async () => {
			const newSession = mock(() =>
				Promise.resolve({ sessionId: "session-1", modes: null, models: null }),
			);
			// @ts-expect-error - accessing private properties to test team ACP payload isolation
			connection.state = "ready";
			// @ts-expect-error - accessing private properties to test team ACP payload isolation
			connection.connection = { newSession };
			const declaration = buildTeamMcpDeclaration({
				agentTeamId: "team-1",
				memberId: "member-1",
			});

			await connection.createSession({
				cwd: "/home/user/project",
				teamMcpDeclaration: declaration,
			});

			expect(newSession).toHaveBeenCalledWith({
				cwd: "/home/user/project",
				mcpServers: [declaration],
			});
		});
	});

	describe("team MCP callback adapter", () => {
		it("routes MCP callbacks to durable mailbox and task handlers", async () => {
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-team-mcp-"));
			const store = new AgentTeamStore(path.join(tempDir, "events.db"));
			try {
				const runtime = new TeamRuntime({ store });
				const created = store.createAgentTeam({
					machineId: "machine-1",
					workspaceRootCwd: "/workspace",
					backendId: "backend-1",
					title: "Callback Team",
					leaderName: "Leader",
				});
				const agentTeamId = created.team.agentTeamId;
				const leaderMemberId = created.team.leaderMemberId;
				const memberId = store.addTeamMember({
					agentTeamId,
					backendId: "backend-1",
					name: "Worker",
					role: "member",
				}).memberId;
				const serverId = `mobvibe-team:${agentTeamId}:${leaderMemberId}`;
				const declaration = buildTeamMcpDeclaration({
					agentTeamId,
					memberId: leaderMemberId,
				});
				const newSession = mock(() =>
					Promise.resolve({
						sessionId: "session-1",
						modes: null,
						models: null,
					}),
				);
				// @ts-expect-error - configuring private connection state for adapter-level test
				connection.state = "ready";
				// @ts-expect-error - configuring private connection state for adapter-level test
				connection.connection = { newSession };

				await connection.createSession({
					cwd: "/workspace",
					teamMcpDeclaration: declaration,
					teamMcpTransport: "acp",
					teamMcpHandlers: runtime.mcpRouter,
				});
				// @ts-expect-error - exercise the private ACP extension adapter directly
				await connection.handleTeamMcpExtensionMethod("mcp/connect", {
					serverId,
				});
				// @ts-expect-error - exercise the private ACP extension adapter directly
				await connection.handleTeamMcpExtensionMethod("mcp/message", {
					serverId,
					type: "list-tools",
					tools: EXPECTED_TEAM_TOOL_NAMES.map((name) => ({ name })),
				});

				const afterListTools = store.getAgentTeam({ agentTeamId }).team;
				expect(afterListTools?.members[0].mcp?.phase).toBe("tools_ready");

				// @ts-expect-error - exercise the private ACP extension adapter directly
				const mailboxResult = await connection.handleTeamMcpExtensionMethod(
					"mcp/message",
					{
						serverId,
						type: "tool-call",
						toolName: "mobvibe_team_send_message",
						args: {
							to: "Worker",
							message: "plaintext stays local",
							fromMemberId: memberId,
						},
					},
				);
				expect(mailboxResult.caller).toEqual(
					expect.objectContaining({ memberId: leaderMemberId }),
				);

				// @ts-expect-error - exercise the private ACP extension adapter directly
				const createdTask = await connection.handleTeamMcpExtensionMethod(
					"mcp/message",
					{
						serverId,
						type: "tool-call",
						toolName: "mobvibe_team_task_create",
						args: {
							title: "Callback task",
							description: "task detail stays local",
							owner: "Worker",
						},
					},
				);
				const taskId = readCreatedTaskId(createdTask);
				// @ts-expect-error - exercise the private ACP extension adapter directly
				const listedTasks = await connection.handleTeamMcpExtensionMethod(
					"mcp/message",
					{
						serverId,
						type: "tool-call",
						toolName: "mobvibe_team_task_list",
						args: {},
					},
				);
				expect(readListedTaskIds(listedTasks)).toContain(taskId);
				// @ts-expect-error - exercise the private ACP extension adapter directly
				await connection.handleTeamMcpExtensionMethod("mcp/message", {
					serverId,
					type: "tool-call",
					toolName: "mobvibe_team_task_update",
					args: { taskId, status: "completed" },
				});

				const summary = store.getAgentTeam({ agentTeamId }).team;
				expect(summary?.mailboxCounts.unread).toBe(1);
				expect(summary?.taskCounts.completed).toBe(1);
				expect(summary?.sourceRefs).toContainEqual(
					expect.objectContaining({
						type: "mailbox_message",
						fromMemberId: leaderMemberId,
						toMemberId: memberId,
					}),
				);
				expect(JSON.stringify(summary)).not.toContain("plaintext stays local");
				expect(JSON.stringify(summary)).not.toContain(
					"task detail stays local",
				);
				// @ts-expect-error - exercise the private ACP extension adapter directly
				await connection.handleTeamMcpExtensionMethod("mcp/disconnect", {
					serverId,
				});
			} finally {
				store.close();
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	describe("getStatus", () => {
		it("returns backend info in status", () => {
			const status = connection.getStatus();

			expect(status.backendId).toBe("test-backend");
			expect(status.backendLabel).toBe("Test Backend");
			expect(status.command).toBe("test-command");
			expect(status.args).toEqual(["--arg1"]);
			expect(status.state).toBe("idle");
		});
	});
});

function readCreatedTaskId(value: unknown): string {
	const response = value as {
		data?: { task?: { taskId?: unknown } };
	};
	const taskId = response.data?.task?.taskId;
	if (typeof taskId !== "string") {
		throw new Error("Expected created task id");
	}
	return taskId;
}

function readListedTaskIds(value: unknown): string[] {
	const response = value as {
		data?: { tasks?: Array<{ taskId?: unknown }> };
	};
	return (response.data?.tasks ?? []).flatMap((task) =>
		typeof task.taskId === "string" ? [task.taskId] : [],
	);
}
