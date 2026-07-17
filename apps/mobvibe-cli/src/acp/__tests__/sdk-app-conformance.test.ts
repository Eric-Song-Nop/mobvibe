import { describe, expect, it } from "bun:test";
import { agent, client, methods } from "@agentclientprotocol/sdk";

describe("ACP SDK app conformance", () => {
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
