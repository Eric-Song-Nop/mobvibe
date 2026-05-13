import type { AgentTeamSummary } from "@mobvibe/shared";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAgentTeamRoutes } from "../agent-teams.js";

vi.mock("../../middleware/auth.js", () => ({
	requireAuth: (request: express.Request, response: express.Response, next: express.NextFunction) => {
		const auth = request.headers.authorization;
		if (!auth?.startsWith("Bearer ")) {
			response.status(401).json({
				error: {
					code: "AUTHORIZATION_FAILED",
					message: "Not authorized",
					retryable: false,
					scope: "request",
				},
			});
			return;
		}
		(request as express.Request & { user?: { id: string } }).user = {
			id: auth.slice("Bearer ".length),
		};
		next();
	},
	getUserId: (request: express.Request) =>
		(request as express.Request & { user?: { id: string } }).user?.id,
}));

const createTeam = (overrides: Partial<AgentTeamSummary> = {}): AgentTeamSummary => ({
	agentTeamId: "team-1",
	machineId: "machine-1",
	title: "Team One",
	workspaceRootCwd: "/repo",
	workspaceMode: "shared_workspace",
	leaderMemberId: "member-1",
	lifecycle: "pending",
	members: [],
	mailboxCounts: { unread: 0, wakePending: 0, wakeFailed: 0 },
	taskCounts: {
		todo: 0,
		inProgress: 0,
		blocked: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
	},
	createdAt: "2026-05-13T00:00:00.000Z",
	updatedAt: "2026-05-13T00:00:00.000Z",
	...overrides,
});

const requestJson = async (
	baseUrl: string,
	path: string,
	options: RequestInit = {},
) => {
	const response = await fetch(`${baseUrl}${path}`, {
		...options,
		headers: {
			"content-type": "application/json",
			...(options.headers ?? {}),
		},
	});
	const payload = await response.json();
	return { response, payload };
};

describe("agent team routes", () => {
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;
	let teamRouter: {
		createAgentTeam: ReturnType<typeof vi.fn>;
		listAgentTeams: ReturnType<typeof vi.fn>;
		getAgentTeam: ReturnType<typeof vi.fn>;
	};

	beforeEach(async () => {
		teamRouter = {
			createAgentTeam: vi.fn(async () => ({ team: createTeam() })),
			listAgentTeams: vi.fn(async () => ({ teams: [createTeam()] })),
			getAgentTeam: vi.fn(async () => ({ team: createTeam() })),
		};
		const app = express();
		app.use(express.json());
		const router = express.Router();
		setupAgentTeamRoutes(router, {} as never, teamRouter as never);
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

	it("requires authentication", async () => {
		const { response, payload } = await requestJson(baseUrl, "/acp/agent-teams");

		expect(response.status).toBe(401);
		expect(payload.error.code).toBe("AUTHORIZATION_FAILED");
		expect(teamRouter.listAgentTeams).not.toHaveBeenCalled();
	});

	it("forwards metadata-only create payloads", async () => {
		const { response, payload } = await requestJson(baseUrl, "/acp/agent-teams", {
			method: "POST",
			headers: { authorization: "Bearer user-1" },
			body: JSON.stringify({
				machineId: "machine-1",
				title: "Team One",
				workspaceRootCwd: "/repo",
				leaderBackendId: "backend-1",
				workspaceMode: "shared_workspace",
			}),
		});

		expect(response.status).toBe(200);
		expect(payload.team.agentTeamId).toBe("team-1");
		expect(teamRouter.createAgentTeam).toHaveBeenCalledWith(
			{
				machineId: "machine-1",
				backendId: "backend-1",
				workspaceRootCwd: "/repo",
				title: "Team One",
				workspaceMode: "shared_workspace",
			},
			"user-1",
		);
	});

	it("lists and gets teams through TeamRouter", async () => {
		const list = await requestJson(baseUrl, "/acp/agent-teams?machineId=machine-1", {
			headers: { authorization: "Bearer user-1" },
		});
		const get = await requestJson(baseUrl, "/acp/agent-teams/team-1?machineId=machine-1", {
			headers: { authorization: "Bearer user-1" },
		});

		expect(list.response.status).toBe(200);
		expect(list.payload.teams).toHaveLength(1);
		expect(get.response.status).toBe(200);
		expect(get.payload.team.agentTeamId).toBe("team-1");
		expect(teamRouter.listAgentTeams).toHaveBeenCalledWith(
			{ machineId: "machine-1" },
			"user-1",
		);
		expect(teamRouter.getAgentTeam).toHaveBeenCalledWith(
			{ agentTeamId: "team-1", machineId: "machine-1" },
			"user-1",
		);
	});

	it("returns not found equivalent for missing teams", async () => {
		teamRouter.getAgentTeam.mockResolvedValueOnce({});

		const { response, payload } = await requestJson(
			baseUrl,
			"/acp/agent-teams/missing?machineId=machine-1",
			{ headers: { authorization: "Bearer user-1" } },
		);

		expect(response.status).toBe(404);
		expect(payload.error.code).toBe("SESSION_NOT_FOUND");
	});

	it("maps ownership and timeout failures without leaking another machine", async () => {
		teamRouter.listAgentTeams.mockRejectedValueOnce(new Error("Machine not found"));
		teamRouter.getAgentTeam.mockRejectedValueOnce(new Error("RPC timeout"));

		const ownership = await requestJson(baseUrl, "/acp/agent-teams?machineId=other", {
			headers: { authorization: "Bearer user-1" },
		});
		const timeout = await requestJson(baseUrl, "/acp/agent-teams/team-1", {
			headers: { authorization: "Bearer user-1" },
		});

		expect(ownership.response.status).toBe(403);
		expect(ownership.payload.error.code).toBe("AUTHORIZATION_FAILED");
		expect(timeout.response.status).toBe(504);
		expect(timeout.payload.error.code).toBe("INTERNAL_ERROR");
	});

	it("rejects forbidden plaintext and secret keys before forwarding", async () => {
		const { response, payload } = await requestJson(baseUrl, "/acp/agent-teams", {
			method: "POST",
			headers: { authorization: "Bearer user-1" },
			body: JSON.stringify({
				machineId: "machine-1",
				workspaceRootCwd: "/repo",
				leaderBackendId: "backend-1",
				metadata: { prompt: "do the work", providerToken: "secret" },
			}),
		});

		expect(response.status).toBe(400);
		expect(payload.error.code).toBe("REQUEST_VALIDATION_FAILED");
		expect(teamRouter.createAgentTeam).not.toHaveBeenCalled();
	});
});
