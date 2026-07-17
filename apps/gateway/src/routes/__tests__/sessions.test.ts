import type { AddressInfo } from "node:net";
import { AppError } from "@mobvibe/shared";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupSessionRoutes } from "../sessions.js";

vi.mock("../../middleware/auth.js", () => ({
	requireAuth: (
		request: express.Request,
		response: express.Response,
		next: express.NextFunction,
	) => {
		const authorization = request.headers.authorization;
		if (!authorization?.startsWith("Bearer ")) {
			response.status(401).json({ error: "Not authorized" });
			return;
		}
		(request as express.Request & { userId?: string }).userId =
			authorization.slice("Bearer ".length);
		next();
	},
	getUserId: (request: express.Request) =>
		(request as express.Request & { userId?: string }).userId,
}));

const encryptedPrompt = { t: "encrypted" as const, c: "ciphertext" };

describe("session message routes", () => {
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;
	let sessionRouter: {
		sendMessage: ReturnType<typeof vi.fn>;
		setSessionMode: ReturnType<typeof vi.fn>;
	};

	beforeEach(async () => {
		sessionRouter = {
			sendMessage: vi.fn(async () => ({ stopReason: "end_turn" })),
			setSessionMode: vi.fn(async () => ({ sessionId: "session-1" })),
		};
		const app = express();
		app.use(express.json());
		const router = express.Router();
		setupSessionRoutes(router, {} as never, sessionRouter as never);
		app.use("/acp", router);
		server = app.listen(0);
		await new Promise<void>((resolve) => server.once("listening", resolve));
		const address = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	it("accepts legacy clients without a messageId and generates one", async () => {
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-1", prompt: encryptedPrompt }),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.sendMessage).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				messageId: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
				),
				prompt: encryptedPrompt,
			},
			"user-1",
		);
	});

	it("rejects message IDs over 128 UTF-8 bytes", async () => {
		const overlongMessageId = "界".repeat(43);
		expect(Buffer.byteLength(overlongMessageId, "utf8")).toBe(129);
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				messageId: overlongMessageId,
				prompt: encryptedPrompt,
			}),
		});

		expect(response.status).toBe(400);
		expect(sessionRouter.sendMessage).not.toHaveBeenCalled();
	});

	it("accepts plaintext content blocks for a no-E2EE CLI", async () => {
		const prompt = [{ type: "text", text: "plain prompt" }];
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				messageId: "plaintext-message-1",
				prompt,
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.sendMessage).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				messageId: "plaintext-message-1",
				prompt,
			},
			"user-1",
		);
	});

	it("provides a bodyless authenticated routing preflight", async () => {
		const response = await fetch(`${baseUrl}/acp/routing`, {
			headers: { authorization: "Bearer user-1" },
		});

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});

	it("forwards messageId unchanged to the CLI RPC", async () => {
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				messageId: "message-stable-1",
				prompt: encryptedPrompt,
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.sendMessage).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				messageId: "message-stable-1",
				prompt: encryptedPrompt,
			},
			"user-1",
		);
	});

	it("canonicalizes messageId before forwarding or logging it", async () => {
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				messageId: `${" ".repeat(256)}message-stable-2${" ".repeat(256)}`,
				prompt: encryptedPrompt,
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.sendMessage).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				messageId: "message-stable-2",
				prompt: encryptedPrompt,
			},
			"user-1",
		);
	});

	it("forwards an expected session revision to the CLI RPC", async () => {
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				messageId: "revision-pinned-message",
				expectedRevision: 7,
				prompt: encryptedPrompt,
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.sendMessage).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				messageId: "revision-pinned-message",
				expectedRevision: 7,
				prompt: encryptedPrompt,
			},
			"user-1",
		);
	});

	it.each([
		0,
		-1,
		1.5,
		"7",
	])("rejects invalid expectedRevision %j", async (expectedRevision) => {
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				messageId: "invalid-revision-pin",
				expectedRevision,
				prompt: encryptedPrompt,
			}),
		});

		expect(response.status).toBe(400);
		expect(sessionRouter.sendMessage).not.toHaveBeenCalled();
	});

	it("returns an indeterminate message outcome as a non-retryable 409", async () => {
		sessionRouter.sendMessage.mockRejectedValueOnce(
			new AppError(
				{
					code: "MESSAGE_OUTCOME_UNKNOWN",
					message: "Send it again as a new message",
					retryable: false,
					scope: "request",
					detail: "The previous outcome could not be proven",
				},
				409,
			),
		);

		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				messageId: "message-unknown-1",
				prompt: encryptedPrompt,
			}),
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: "MESSAGE_OUTCOME_UNKNOWN",
				message: "Send it again as a new message",
				retryable: false,
				scope: "request",
				detail: "The previous outcome could not be proven",
			},
		});
	});

	it("preserves structured AppError responses for non-message session RPCs", async () => {
		sessionRouter.setSessionMode.mockRejectedValueOnce(
			new AppError(
				{
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid mode ID",
					retryable: false,
					scope: "request",
				},
				400,
			),
		);

		const response = await fetch(`${baseUrl}/acp/session/mode`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-1", modeId: "invalid" }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "REQUEST_VALIDATION_FAILED",
				message: "Invalid mode ID",
				retryable: false,
				scope: "request",
			},
		});
	});

	it("sanitizes structured internal errors from non-message session RPCs", async () => {
		sessionRouter.setSessionMode.mockRejectedValueOnce(
			new AppError(
				{
					code: "INTERNAL_ERROR",
					message: "ENOENT /Users/alice/private/token.txt",
					retryable: true,
					scope: "request",
					detail: "secret stack trace",
				},
				500,
			),
		);

		const response = await fetch(`${baseUrl}/acp/session/mode`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-1", modeId: "mode-1" }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: {
				code: "INTERNAL_ERROR",
				message: "Internal server error",
				retryable: true,
				scope: "request",
			},
		});
	});

	it("maps unknown non-message session errors to a sanitized 500", async () => {
		sessionRouter.setSessionMode.mockRejectedValueOnce(
			new Error("unexpected private failure"),
		);

		const response = await fetch(`${baseUrl}/acp/session/mode`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-1", modeId: "mode-1" }),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: {
				code: "INTERNAL_ERROR",
				message: "Internal server error",
				retryable: true,
				scope: "session",
			},
		});
	});
});
