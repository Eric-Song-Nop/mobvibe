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

	it("requires a stable messageId for idempotent sends", async () => {
		const response = await fetch(`${baseUrl}/acp/message`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-1", prompt: encryptedPrompt }),
		});

		expect(response.status).toBe(400);
		expect(sessionRouter.sendMessage).not.toHaveBeenCalled();
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
