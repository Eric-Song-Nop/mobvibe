import type { AddressInfo } from "node:net";
import { AppError, type SessionSummary } from "@mobvibe/shared";
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
		createSession: ReturnType<typeof vi.fn>;
		closeSession: ReturnType<typeof vi.fn>;
		discoverSessions: ReturnType<typeof vi.fn>;
		loadSession: ReturnType<typeof vi.fn>;
		resumeSession: ReturnType<typeof vi.fn>;
		reloadSession: ReturnType<typeof vi.fn>;
		sendMessage: ReturnType<typeof vi.fn>;
		setSessionConfigOption: ReturnType<typeof vi.fn>;
		setSessionMode: ReturnType<typeof vi.fn>;
	};
	let cliRegistry: {
		addDiscoveredSessionsForMachine: ReturnType<typeof vi.fn>;
		getCliByMachineIdForUser: ReturnType<typeof vi.fn>;
	};

	beforeEach(async () => {
		sessionRouter = {
			createSession: vi.fn(async () => ({ sessionId: "session-created" })),
			closeSession: vi.fn(async () => ({
				sessionId: "session-1",
				isAttached: false,
			})),
			discoverSessions: vi.fn(async () => ({ sessions: [] })),
			loadSession: vi.fn(async () => ({ sessionId: "session-loaded" })),
			resumeSession: vi.fn(async () => ({ sessionId: "session-resumed" })),
			reloadSession: vi.fn(async () => ({ sessionId: "session-reloaded" })),
			sendMessage: vi.fn(async () => ({ stopReason: "end_turn" })),
			setSessionConfigOption: vi.fn(async () => ({ sessionId: "session-1" })),
			setSessionMode: vi.fn(async () => ({ sessionId: "session-1" })),
		};
		cliRegistry = {
			addDiscoveredSessionsForMachine: vi.fn(),
			getCliByMachineIdForUser: vi.fn(() => ({
				machineId: "machine-1",
				backends: [{ backendId: "backend-1", backendLabel: "Test Backend" }],
				sessions: [],
			})),
		};
		const app = express();
		app.use(express.json());
		const router = express.Router();
		setupSessionRoutes(router, cliRegistry as never, sessionRouter as never);
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

	it("validates, deduplicates, and forwards additional directories on create", async () => {
		const response = await fetch(`${baseUrl}/acp/session`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				cwd: "/repo",
				backendId: "backend-1",
				machineId: "machine-1",
				additionalDirectories: ["/data", "/data", "/data/nested"],
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.createSession).toHaveBeenCalledWith(
			{
				cwd: "/repo",
				additionalDirectories: ["/data", "/data/nested"],
				backendId: "backend-1",
				machineId: "machine-1",
				title: undefined,
				worktree: undefined,
			},
			"user-1",
		);
	});

	it("rejects relative additional directories before routing", async () => {
		const response = await fetch(`${baseUrl}/acp/session`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				cwd: "/repo",
				backendId: "backend-1",
				additionalDirectories: ["relative/path"],
			}),
		});

		expect(response.status).toBe(400);
		expect(sessionRouter.createSession).not.toHaveBeenCalled();
	});

	it("returns a capability error when create roots are unsupported", async () => {
		sessionRouter.createSession.mockRejectedValueOnce(
			new Error(
				"Agent does not support session additionalDirectories capability",
			),
		);
		const response = await fetch(`${baseUrl}/acp/session`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				cwd: "/repo",
				backendId: "backend-1",
				additionalDirectories: ["/data"],
			}),
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: expect.objectContaining({
				code: "CAPABILITY_NOT_SUPPORTED",
				retryable: false,
				scope: "session",
			}),
		});
	});

	it("preserves additional directories when registering discovered sessions", async () => {
		sessionRouter.discoverSessions.mockResolvedValueOnce({
			sessions: [
				{
					sessionId: "historical-session",
					title: "Historical session",
					cwd: "/repo",
					additionalDirectories: ["/data", "/docs"],
					updatedAt: "2026-07-17T00:00:00.000Z",
					_meta: { source: "agent", keep: null },
				},
			],
		});

		const response = await fetch(
			`${baseUrl}/acp/sessions/discover?machineId=machine-1&backendId=backend-1`,
			{
				headers: { authorization: "Bearer user-1" },
			},
		);

		expect(response.status).toBe(200);
		expect(cliRegistry.addDiscoveredSessionsForMachine).toHaveBeenCalledWith(
			"machine-1",
			[
				expect.objectContaining({
					sessionId: "historical-session",
					additionalDirectories: ["/data", "/docs"],
					backendId: "backend-1",
					backendLabel: "Test Backend",
					_meta: { source: "agent", keep: null },
				}),
			],
			"user-1",
		);
	});

	it("keeps discovery timestamps stable when the agent clears updatedAt", async () => {
		cliRegistry.getCliByMachineIdForUser.mockReturnValueOnce({
			machineId: "machine-1",
			backends: [{ backendId: "backend-1", backendLabel: "Test Backend" }],
			sessions: [
				{
					sessionId: "historical-session",
					title: "Historical session",
					backendId: "backend-1",
					backendLabel: "Test Backend",
					createdAt: "2026-06-01T00:00:00.000Z",
					updatedAt: "2026-07-01T00:00:00.000Z",
				},
			],
		});
		sessionRouter.discoverSessions.mockResolvedValueOnce({
			sessions: [
				{
					sessionId: "historical-session",
					title: null,
					cwd: "/repo",
					updatedAt: null,
				},
				{
					sessionId: "without-agent-time",
					cwd: "/repo",
					updatedAt: null,
				},
			],
		});

		const response = await fetch(
			`${baseUrl}/acp/sessions/discover?machineId=machine-1&backendId=backend-1`,
			{ headers: { authorization: "Bearer user-1" } },
		);

		expect(response.status).toBe(200);
		expect(cliRegistry.addDiscoveredSessionsForMachine).toHaveBeenCalledWith(
			"machine-1",
			[
				expect.objectContaining({
					sessionId: "historical-session",
					createdAt: "2026-06-01T00:00:00.000Z",
					updatedAt: "2026-07-01T00:00:00.000Z",
				}),
				expect.objectContaining({
					sessionId: "without-agent-time",
					createdAt: expect.any(String),
					updatedAt: expect.any(String),
				}),
			],
			"user-1",
		);
		const addedSessions = cliRegistry.addDiscoveredSessionsForMachine.mock
			.calls[0]?.[1] as SessionSummary[] | undefined;
		expect(addedSessions?.[1]?.updatedAt).not.toBe("1970-01-01T00:00:00.000Z");
		expect(addedSessions?.[1]?.createdAt).toBe(addedSessions?.[1]?.updatedAt);
	});

	it("forwards the complete list when loading a session", async () => {
		const response = await fetch(`${baseUrl}/acp/session/load`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				cwd: "/repo",
				backendId: "backend-1",
				machineId: "machine-1",
				additionalDirectories: ["/data"],
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.loadSession).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				cwd: "/repo",
				additionalDirectories: ["/data"],
				backendId: "backend-1",
				machineId: "machine-1",
			},
			"user-1",
		);
	});

	it("validates and forwards a resume request with machine affinity", async () => {
		const response = await fetch(`${baseUrl}/acp/session/resume`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				cwd: "/repo",
				backendId: "backend-1",
				machineId: "machine-1",
				additionalDirectories: ["/data", "/data", "/shared"],
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.resumeSession).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				cwd: "/repo",
				additionalDirectories: ["/data", "/shared"],
				backendId: "backend-1",
				machineId: "machine-1",
			},
			"user-1",
		);
	});

	it("rejects empty or relative resume paths at the API boundary", async () => {
		for (const cwd of ["", "relative/project"]) {
			const response = await fetch(`${baseUrl}/acp/session/resume`, {
				method: "POST",
				headers: {
					authorization: "Bearer user-1",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					sessionId: "session-1",
					cwd,
					backendId: "backend-1",
				}),
			});

			expect(response.status).toBe(400);
		}
		expect(sessionRouter.resumeSession).not.toHaveBeenCalled();
	});

	it("maps resume capability failures to 409", async () => {
		sessionRouter.resumeSession.mockRejectedValueOnce(
			new Error("Agent does not support session/resume capability"),
		);
		const response = await fetch(`${baseUrl}/acp/session/resume`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				cwd: "/repo",
				backendId: "backend-1",
				machineId: "machine-1",
			}),
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: expect.objectContaining({ code: "CAPABILITY_NOT_SUPPORTED" }),
		});
	});

	it("closes an active ACP session and returns its detached summary", async () => {
		const response = await fetch(`${baseUrl}/acp/session/close`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-1" }),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.closeSession).toHaveBeenCalledWith(
			{ sessionId: "session-1" },
			"user-1",
		);
		expect(await response.json()).toEqual({
			sessionId: "session-1",
			isAttached: false,
		});
	});

	it("maps close capability failures to 409", async () => {
		sessionRouter.closeSession.mockRejectedValueOnce(
			new Error("Agent does not support session/close capability"),
		);
		const response = await fetch(`${baseUrl}/acp/session/close`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-1" }),
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: expect.objectContaining({ code: "CAPABILITY_NOT_SUPPORTED" }),
		});
	});

	it("requires authorization for session close", async () => {
		const response = await fetch(`${baseUrl}/acp/session/close`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionId: "session-1" }),
		});

		expect(response.status).toBe(401);
		expect(sessionRouter.closeSession).not.toHaveBeenCalled();
	});

	it("does not reveal a missing or unauthorized session during close", async () => {
		sessionRouter.closeSession.mockRejectedValueOnce(
			new Error("Session not found"),
		);
		const response = await fetch(`${baseUrl}/acp/session/close`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({ sessionId: "session-other" }),
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: expect.objectContaining({ code: "AUTHORIZATION_FAILED" }),
		});
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

	it("forwards protocol-native select config values and metadata", async () => {
		const response = await fetch(`${baseUrl}/acp/session/config-option`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				configId: "thinking-level",
				value: "high",
				_meta: { source: "settings-menu" },
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.setSessionConfigOption).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				configId: "thinking-level",
				value: "high",
				_meta: { source: "settings-menu" },
			},
			"user-1",
		);
	});

	it("forwards protocol-native boolean config values", async () => {
		const response = await fetch(`${baseUrl}/acp/session/config-option`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				configId: "auto-approve",
				type: "boolean",
				value: true,
			}),
		});

		expect(response.status).toBe(200);
		expect(sessionRouter.setSessionConfigOption).toHaveBeenCalledWith(
			{
				sessionId: "session-1",
				configId: "auto-approve",
				type: "boolean",
				value: true,
			},
			"user-1",
		);
	});

	it.each([
		{ type: "boolean", value: "true" },
		{ type: "boolean", value: 1 },
		{ type: "future-select-variant", value: "high" },
		{ value: false },
		{ value: 1 },
	])("rejects an invalid protocol-native config value %#", async (config) => {
		const response = await fetch(`${baseUrl}/acp/session/config-option`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				configId: "invalid-config",
				...config,
			}),
		});

		expect(response.status).toBe(400);
		expect(sessionRouter.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("preserves structured config RPC errors", async () => {
		sessionRouter.setSessionConfigOption.mockRejectedValueOnce(
			new AppError(
				{
					code: "REQUEST_VALIDATION_FAILED",
					message: "Invalid config value",
					retryable: false,
					scope: "request",
				},
				400,
			),
		);

		const response = await fetch(`${baseUrl}/acp/session/config-option`, {
			method: "POST",
			headers: {
				authorization: "Bearer user-1",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId: "session-1",
				configId: "thinking-level",
				value: "impossible",
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "REQUEST_VALIDATION_FAILED",
				message: "Invalid config value",
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
