import { createErrorDetail, createInternalError } from "@mobvibe/shared";
import type { Router } from "express";
import { logger } from "../lib/logger.js";
import {
	type AuthenticatedRequest,
	getUserId,
	requireAuth,
} from "../middleware/auth.js";
import type { CliRegistry } from "../services/cli-registry.js";
import type { TeamRouter } from "../services/team-router.js";
import {
	type ErrorResponse,
	respondAppError,
	respondError,
} from "./error-response.js";

const FORBIDDEN_KEYS = new Set([
	"prompt",
	"content",
	"body",
	"description",
	"summaryText",
	"agentOutput",
	"providerToken",
	"masterSecret",
	"dek",
	"secret",
]);

const buildRequestValidationError = (message = "Invalid request") =>
	createErrorDetail({
		code: "REQUEST_VALIDATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});

const buildAuthorizationError = (message = "Not authorized") =>
	createErrorDetail({
		code: "AUTHORIZATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});

const buildNotFoundError = (message = "Agent Team not found") =>
	createErrorDetail({
		code: "SESSION_NOT_FOUND",
		message,
		retryable: false,
		scope: "request",
	});

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const rejectForbiddenKeys = (value: unknown): string | undefined => {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = rejectForbiddenKeys(item);
			if (found) return found;
		}
		return undefined;
	}
	for (const [key, nested] of Object.entries(value)) {
		if (FORBIDDEN_KEYS.has(key)) {
			return key;
		}
		const found = rejectForbiddenKeys(nested);
		if (found) return found;
	}
	return undefined;
};

const optionalString = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

const mapRouteError = (response: ErrorResponse, error: unknown) => {
	if (respondAppError(response, error)) {
		return;
	}
	const message = getErrorMessage(error);
	if (message.includes("Machine not found")) {
		respondError(response, buildAuthorizationError(message), 403);
		return;
	}
	if (message.includes("No CLI connected")) {
		respondError(response, buildAuthorizationError(message), 503);
		return;
	}
	if (message.includes("RPC timeout")) {
		respondError(response, createInternalError("service"), 504);
		return;
	}
	respondError(response, createInternalError("service"));
};

export function setupAgentTeamRoutes(
	router: Router,
	_cliRegistry: CliRegistry,
	teamRouter: TeamRouter,
) {
	router.use(requireAuth);

	router.post(
		"/agent-teams",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			const forbiddenKey = rejectForbiddenKeys(request.body);
			if (forbiddenKey) {
				respondError(
					response,
					buildRequestValidationError(
						`Forbidden Agent Team field: ${forbiddenKey}`,
					),
					400,
				);
				return;
			}

			const {
				machineId,
				title,
				workspaceRootCwd,
				leaderBackendId,
				workspaceMode,
			} = request.body ?? {};
			if (
				typeof machineId !== "string" ||
				typeof workspaceRootCwd !== "string" ||
				typeof leaderBackendId !== "string"
			) {
				respondError(
					response,
					buildRequestValidationError(
						"machineId, workspaceRootCwd, and leaderBackendId required",
					),
					400,
				);
				return;
			}

			try {
				logger.info({ userId, machineId }, "agent_team_create_request");
				const result = await teamRouter.createAgentTeam(
					{
						machineId: machineId.trim(),
						backendId: leaderBackendId.trim(),
						workspaceRootCwd: workspaceRootCwd.trim(),
						title: optionalString(title),
						workspaceMode:
							workspaceMode === "per_member_worktree" ||
							workspaceMode === "shared_workspace"
								? workspaceMode
								: undefined,
					},
					userId,
				);
				response.json(result);
			} catch (error) {
				logger.error(
					{ err: error, userId, machineId },
					"agent_team_create_error",
				);
				mapRouteError(response, error);
			}
		},
	);

	router.get(
		"/agent-teams",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const machineId = optionalString(request.query.machineId);
				const result = await teamRouter.listAgentTeams({ machineId }, userId);
				response.json(result);
			} catch (error) {
				logger.error({ err: error, userId }, "agent_teams_list_error");
				mapRouteError(response, error);
			}
		},
	);

	router.get(
		"/agent-teams/:agentTeamId",
		async (request: AuthenticatedRequest, response) => {
			const userId = getUserId(request);
			if (!userId) {
				respondError(response, buildAuthorizationError(), 401);
				return;
			}
			try {
				const result = await teamRouter.getAgentTeam(
					{
						agentTeamId: request.params.agentTeamId,
						machineId: optionalString(request.query.machineId),
					},
					userId,
				);
				if (!result.team) {
					respondError(response, buildNotFoundError(), 404);
					return;
				}
				response.json(result);
			} catch (error) {
				logger.error(
					{ err: error, userId, agentTeamId: request.params.agentTeamId },
					"agent_team_get_error",
				);
				mapRouteError(response, error);
			}
		},
	);

	return router;
}
