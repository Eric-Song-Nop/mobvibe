import { describe, expect, it } from "bun:test";
import {
	agent,
	type ConnectMcpRequest,
	type ConnectMcpResponse,
	client,
	type DisconnectMcpRequest,
	type DisconnectMcpResponse,
	type MessageMcpNotification,
	type MessageMcpRequest,
	type MessageMcpResponse,
	methods,
	ndJsonStream,
} from "@agentclientprotocol/sdk";
import {
	registerTeamMcpProtocolHandlers,
	TeamMcpProtocolAdapter,
	type TeamMcpProtocolHandlers,
} from "../../team/team-mcp-protocol.js";
import { EXPECTED_TEAM_TOOL_NAMES } from "../../team/team-tool-handlers.js";
import {
	ACP_CLIENT_CAPABILITIES,
	filterInvalidRawPlanSessionUpdates,
} from "../acp-connection.js";

describe("ACP SDK app conformance", () => {
	it("negotiates Draft plan operations as an all-or-nothing client capability", async () => {
		let receivedCapabilities: unknown;
		const agentApp = agent({ name: "mobvibe-test-agent" }).onRequest(
			methods.agent.initialize,
			({ params }) => {
				receivedCapabilities = params.clientCapabilities;
				return { protocolVersion: 1 };
			},
		);
		const connection = client({ name: "mobvibe-test-client" }).connect(
			agentApp,
		);

		await connection.agent.request(methods.agent.initialize, {
			protocolVersion: 1,
			clientCapabilities: ACP_CLIENT_CAPABILITIES,
		});

		expect(receivedCapabilities).toEqual(expect.objectContaining({ plan: {} }));
		connection.close();
		await connection.closed;
	});

	it("round-trips SDK 1.2.1 plan operations with planId", async () => {
		const received: unknown[] = [];
		const clientApp = client({ name: "mobvibe-test-client" }).onNotification(
			methods.client.session.update,
			({ params }) => {
				received.push(params);
			},
		);
		const connection = agent({ name: "mobvibe-test-agent" }).connect(clientApp);

		await connection.client.notify(methods.client.session.update, {
			sessionId: "session-1",
			update: {
				sessionUpdate: "plan_update",
				plan: {
					type: "markdown",
					planId: "design",
					content: "## Design",
				},
			},
		});
		await connection.client.notify(methods.client.session.update, {
			sessionId: "session-1",
			update: { sessionUpdate: "plan_removed", planId: "design" },
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				update: {
					sessionUpdate: "plan_update",
					plan: {
						type: "markdown",
						planId: "design",
						content: "## Design",
					},
				},
			},
			{
				sessionId: "session-1",
				update: { sessionUpdate: "plan_removed", planId: "design" },
			},
		]);
		connection.close();
		await connection.closed;
	});

	it("round-trips the Team MCP lifecycle through real SDK app handlers", async () => {
		const serverId = "mobvibe-team:team-1:member-1";
		const lifecycle: string[] = [];
		const handlers: TeamMcpProtocolHandlers = {
			handleConnect: (input) => {
				lifecycle.push(`connect:${input.serverId}`);
			},
			handleListTools: (input) => {
				lifecycle.push(`list:${input.serverId}`);
			},
			handleToolCall: (input) => {
				lifecycle.push(`call:${input.toolName}`);
				return {
					caller: {
						agentTeamId: "team-1",
						memberId: "member-1",
						role: "leader",
					},
					toolName: input.toolName,
					data: { ok: true, args: input.args },
				};
			},
			handleDisconnect: (input) => {
				lifecycle.push(`disconnect:${input.serverId}`);
			},
		};
		const adapter = new TeamMcpProtocolAdapter();
		adapter.configure({
			declaration: {
				type: "acp",
				name: "mobvibe-team",
				serverId,
			},
			handlers,
		});
		const clientApp = registerTeamMcpProtocolHandlers(
			client({ name: "mobvibe-team-test-client" }),
			adapter,
		);
		const connection = agent({ name: "mobvibe-team-test-agent" }).connect(
			clientApp,
		);

		try {
			const connected = await connection.client.request<
				ConnectMcpResponse,
				ConnectMcpRequest
			>("mcp/connect", { serverId });
			expect(connected.connectionId).toBeString();
			expect(connected.connectionId).not.toBe(serverId);

			const initialized = await connection.client.request<
				MessageMcpResponse,
				MessageMcpRequest
			>("mcp/message", {
				connectionId: connected.connectionId,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "test-agent", version: "1.0.0" },
				},
			});
			expect(initialized).toEqual(
				expect.objectContaining({
					protocolVersion: "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: expect.objectContaining({ name: "mobvibe-team" }),
				}),
			);

			await connection.client.notify<MessageMcpNotification>("mcp/message", {
				connectionId: connected.connectionId,
				method: "notifications/initialized",
			});

			const listed = await connection.client.request<
				MessageMcpResponse,
				MessageMcpRequest
			>("mcp/message", {
				connectionId: connected.connectionId,
				method: "tools/list",
			});
			expect(listed).toEqual({
				tools: expect.arrayContaining(
					EXPECTED_TEAM_TOOL_NAMES.map((name) =>
						expect.objectContaining({ name }),
					),
				),
			});

			const called = await connection.client.request<
				MessageMcpResponse,
				MessageMcpRequest
			>("mcp/message", {
				connectionId: connected.connectionId,
				method: "tools/call",
				params: {
					name: "mobvibe_team_members",
					arguments: { attemptedMemberId: "member-other" },
				},
			});
			expect(called).toEqual(
				expect.objectContaining({
					content: [
						expect.objectContaining({
							type: "text",
							text: expect.stringContaining('"ok":true'),
						}),
					],
					structuredContent: expect.objectContaining({
						toolName: "mobvibe_team_members",
						data: {
							ok: true,
							args: { attemptedMemberId: "member-other" },
						},
					}),
				}),
			);

			const disconnected = await connection.client.request<
				DisconnectMcpResponse,
				DisconnectMcpRequest
			>("mcp/disconnect", {
				connectionId: connected.connectionId,
			});
			expect(disconnected).toEqual({});
			await expect(
				connection.client.request<MessageMcpResponse, MessageMcpRequest>(
					"mcp/message",
					{
						connectionId: connected.connectionId,
						method: "tools/list",
					},
				),
			).rejects.toThrow("connection is not active");
			expect(lifecycle).toEqual([
				`connect:${serverId}`,
				`list:${serverId}`,
				"call:mobvibe_team_members",
				`disconnect:${serverId}`,
			]);
		} finally {
			connection.close();
			await connection.closed;
		}
	});

	it("rejects malformed Plan notifications from the raw NDJSON wire", async () => {
		const incomingBytes = new TransformStream<Uint8Array>();
		const rawStream = ndJsonStream(
			new WritableStream<Uint8Array>(),
			incomingBytes.readable,
		);
		let rejected = 0;
		const guardedStream = filterInvalidRawPlanSessionUpdates(rawStream, () => {
			rejected += 1;
		});
		expect(guardedStream.writable).toBe(rawStream.writable);

		const walCandidates: unknown[] = [];
		let resolveLastValidUpdate: (() => void) | undefined;
		const lastValidUpdate = new Promise<void>((resolve) => {
			resolveLastValidUpdate = resolve;
		});
		const connection = client({ name: "raw-wire-plan-client" })
			.onNotification(methods.client.session.update, ({ params }) => {
				walCandidates.push(params);
				if (params.update.sessionUpdate === "plan_removed") {
					resolveLastValidUpdate?.();
				}
			})
			.connect(guardedStream);

		const validEntry = {
			content: "Keep the original entry",
			priority: "high",
			status: "pending",
		};
		const notification = (update: unknown) => ({
			jsonrpc: "2.0",
			method: "session/update",
			params: { sessionId: "session-1", update },
		});
		const messages = [
			notification({
				sessionUpdate: "plan",
				entries: [
					validEntry,
					{ content: 42, priority: "low", status: "pending" },
				],
			}),
			notification({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "non-plan pass-through" },
			}),
			notification({
				sessionUpdate: "plan",
				entries: { first: validEntry },
			}),
			notification({
				sessionUpdate: "plan_update",
				plan: {
					type: "items",
					planId: "implementation",
					entries: [
						validEntry,
						{ content: "Bad priority", priority: "urgent", status: "pending" },
					],
				},
			}),
			notification({ sessionUpdate: "plan", entries: [validEntry] }),
			notification({
				sessionUpdate: "plan_update",
				plan: {
					type: "items",
					planId: "implementation",
					entries: "not-an-array",
				},
			}),
			notification({
				sessionUpdate: "plan_update",
				plan: {
					type: "markdown",
					planId: "implementation",
					content: "## Valid update",
				},
			}),
			notification({ sessionUpdate: "plan_removed", planId: "\n" }),
			notification({
				sessionUpdate: "plan_removed",
				planId: "implementation",
			}),
		];
		const writer = incomingBytes.writable.getWriter();
		await writer.write(
			new TextEncoder().encode(
				`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
			),
		);
		await lastValidUpdate;
		await writer.close();
		writer.releaseLock();
		await connection.closed;

		expect(rejected).toBe(5);
		expect(walCandidates).toEqual([
			{
				sessionId: "session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "non-plan pass-through" },
				},
			},
			{
				sessionId: "session-1",
				update: { sessionUpdate: "plan", entries: [validEntry] },
			},
			{
				sessionId: "session-1",
				update: {
					sessionUpdate: "plan_update",
					plan: {
						type: "markdown",
						planId: "implementation",
						content: "## Valid update",
					},
				},
			},
			{
				sessionId: "session-1",
				update: {
					sessionUpdate: "plan_removed",
					planId: "implementation",
				},
			},
		]);
	});

	it("propagates request cancellation alongside session/cancel", async () => {
		let promptSignal: AbortSignal | undefined;
		let resolvePromptStarted: (() => void) | undefined;
		const promptStarted = new Promise<void>((resolve) => {
			resolvePromptStarted = resolve;
		});
		let sessionCancelReceived = false;
		const agentApp = agent({ name: "mobvibe-test-agent" })
			.onRequest(methods.agent.session.prompt, async ({ signal }) => {
				promptSignal = signal;
				resolvePromptStarted?.();
				if (!signal.aborted) {
					await new Promise<void>((resolve) => {
						signal.addEventListener("abort", () => resolve(), { once: true });
					});
				}
				return { stopReason: "cancelled" };
			})
			.onNotification(methods.agent.session.cancel, () => {
				sessionCancelReceived = true;
			});
		const connection = client({ name: "mobvibe-test-client" }).connect(
			agentApp,
		);
		const controller = new AbortController();
		const prompt = connection.agent.request(
			methods.agent.session.prompt,
			{
				sessionId: "session-1",
				prompt: [{ type: "text", text: "hello" }],
			},
			{ cancellationSignal: controller.signal },
		);

		await promptStarted;
		controller.abort();
		await connection.agent.notify(methods.agent.session.cancel, {
			sessionId: "session-1",
		});

		await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
		expect(promptSignal?.aborted).toBe(true);
		expect(sessionCancelReceived).toBe(true);
		connection.close();
		await connection.closed;
	});
});
