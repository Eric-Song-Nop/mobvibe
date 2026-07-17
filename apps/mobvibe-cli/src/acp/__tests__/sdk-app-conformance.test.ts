import { describe, expect, it } from "bun:test";
import { agent, client, methods, ndJsonStream } from "@agentclientprotocol/sdk";
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
