import path from "node:path";
import {
	AppError,
	createErrorDetail,
	createInternalError,
} from "@mobvibe/shared";
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

const requiredString = (value: unknown, field: string): string => {
	const parsed = optionalString(value);
	if (!parsed) {
		throw new AppError(
			buildRequestValidationError(`${field} must be a non-empty string`),
			400,
		);
	}
	return parsed;
};

const parseWorkspaceMode = (value: unknown, provided: boolean) => {
	if (!provided) return undefined;
	if (value === "per_member_worktree" || value === "shared_workspace") {
		return value;
	}
	throw new AppError(
		buildRequestValidationError(
			"workspaceMode must be per_member_worktree or shared_workspace",
		),
		400,
	);
};

const normalizeRelativeCwd = (value: unknown): string | undefined => {
	const trimmed = optionalString(value);
	if (!trimmed) return undefined;
	if (path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
		throw new AppError(
			buildRequestValidationError(
				"worktree.relativeCwd must be a relative subdirectory",
			),
			400,
		);
	}
	const segments = trimmed.split(/[/\\]+/).filter(Boolean);
	if (
		segments.length === 0 ||
		segments.some((segment) => segment === "." || segment === "..")
	) {
		throw new AppError(
			buildRequestValidationError(
				"worktree.relativeCwd must be a normalized subdirectory path",
			),
			400,
		);
	}
	return segments.join("/");
};

const parseWorktreeOptions = (value: unknown, provided: boolean) => {
	if (!provided) {
		return undefined;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AppError(
			buildRequestValidationError("worktree must be an object"),
			400,
		);
	}
	const worktree = value as Record<string, unknown>;
	const sourceCwd = requiredString(worktree.sourceCwd, "worktree.sourceCwd");
	const branch = optionalString(worktree.branch);
	const baseBranch = optionalString(worktree.baseBranch);
	if (branch?.startsWith("-") || baseBranch?.startsWith("-")) {
		throw new AppError(
			buildRequestValidationError("Branch name cannot start with '-'"),
			400,
		);
	}
	return {
		branch,
		baseBranch,
		sourceCwd,
		relativeCwd: normalizeRelativeCwd(worktree.relativeCwd),
	};
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
		respondError(response, createInternalError("service"), 503);
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

			const body = request.body ?? {};
			const {
				machineId,
				title,
				workspaceRootCwd,
				leaderBackendId,
				workspaceMode,
				worktree,
			} = body;

			try {
				const parsedMachineId = requiredString(machineId, "machineId");
				const parsedWorkspaceRootCwd = requiredString(
					workspaceRootCwd,
					"workspaceRootCwd",
				);
				const parsedLeaderBackendId = requiredString(
					leaderBackendId,
					"leaderBackendId",
				);
				const worktreeOptions = parseWorktreeOptions(
					worktree,
					Object.hasOwn(body, "worktree"),
				);
				const parsedWorkspaceMode = parseWorkspaceMode(
					workspaceMode,
					Object.hasOwn(body, "workspaceMode"),
				);
				logger.info(
					{ userId, machineId: parsedMachineId },
					"agent_team_create_request",
				);
				const result = await teamRouter.createAgentTeam(
					{
						machineId: parsedMachineId,
						backendId: parsedLeaderBackendId,
						workspaceRootCwd: parsedWorkspaceRootCwd,
						title: optionalString(title),
						workspaceMode: parsedWorkspaceMode,
						worktree: worktreeOptions,
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
