import type { AddressInfo } from "node:net";
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
	let sessionRouter: { sendMessage: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		sessionRouter = {
			sendMessage: vi.fn(async () => ({ stopReason: "end_turn" })),
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
});
