import {
	type AgentTeamSummary,
	createErrorDetail,
	type TeamSourceRef,
} from "@mobvibe/shared";
import type {
	AgentTeamStore,
	TeamToolIntent,
	TeamToolIntentKind,
} from "./agent-team-store.js";
import { type MailboxSendResult, MailboxService } from "./mailbox-service.js";
import {
	type TaskBoardResult,
	TaskBoardService,
} from "./task-board-service.js";

export const EXPECTED_TEAM_TOOL_NAMES = [
	"mobvibe_team_send_message",
	"mobvibe_team_members",
	"mobvibe_team_spawn_member",
	"mobvibe_team_task_create",
	"mobvibe_team_task_list",
	"mobvibe_team_task_update",
] as const;

export type TeamToolName = (typeof EXPECTED_TEAM_TOOL_NAMES)[number];

export type TeamToolCaller = {
	agentTeamId: string;
	memberId: string;
	role: "leader" | "member";
};

export type TeamToolResult = {
	caller: TeamToolCaller;
	toolName: TeamToolName;
	data: unknown;
};

export type SpawnMemberResult =
	| {
			ok: true;
			memberId: string;
			sessionId: string;
			backendId: string;
			name: string;
			requestedByMemberId: string;
	  }
	| {
			ok: false;
			memberId?: string;
			error: ReturnType<typeof createErrorDetail>;
	  };

export type TeamToolHandlersOptions = {
	store: AgentTeamStore;
	requestPermission?: (input: unknown) => Promise<unknown>;
	onAgentTeamChanged?: (team: AgentTeamSummary) => void;
	services?: {
		sendMessage?: (
			caller: TeamToolCaller,
			args: { to: string; message: string; summary?: string },
		) => Promise<unknown> | unknown;
		createTask?: (caller: TeamToolCaller, args: unknown) => Promise<unknown>;
		listTasks?: (caller: TeamToolCaller, args: unknown) => Promise<unknown>;
		updateTask?: (caller: TeamToolCaller, args: unknown) => Promise<unknown>;
		spawnMember?: (
			caller: TeamToolCaller,
			args: { name?: string; backendId?: string },
		) => Promise<SpawnMemberResult> | SpawnMemberResult;
	};
};

const forbiddenPayloadKeys = new Set([
	"prompt",
	"content",
	"body",
	"description",
	"secret",
	"providerToken",
	"masterSecret",
	"dek",
]);

export class TeamToolHandlers {
	private readonly options: TeamToolHandlersOptions;
	private readonly mailboxService: MailboxService;
	private readonly taskBoardService: TaskBoardService;

	constructor(options: TeamToolHandlersOptions) {
		this.options = options;
		this.mailboxService = new MailboxService(options.store);
		this.taskBoardService = new TaskBoardService(options.store);
	}

	getToolNames(): TeamToolName[] {
		return [...EXPECTED_TEAM_TOOL_NAMES];
	}

	async dispatch(input: {
		caller: TeamToolCaller;
		toolName: TeamToolName;
		args: unknown;
	}): Promise<TeamToolResult> {
		const data = await this.dispatchData(
			input.caller,
			input.toolName,
			input.args,
		);
		return { caller: input.caller, toolName: input.toolName, data };
	}

	recordLifecycleIntent(input: {
		caller: TeamToolCaller;
		kind: TeamToolIntentKind;
		payload: Record<string, unknown>;
		sourceRefs: TeamSourceRef[];
	}): TeamToolIntent {
		return this.options.store.createTeamToolIntent({
			agentTeamId: input.caller.agentTeamId,
			requestedByMemberId: input.caller.memberId,
			kind: input.kind,
			payload: sanitizePayload(input.payload),
			sourceRefs: input.sourceRefs,
		});
	}

	private async dispatchData(
		caller: TeamToolCaller,
		toolName: TeamToolName,
		args: unknown,
	): Promise<unknown> {
		switch (toolName) {
			case "mobvibe_team_members":
				return this.options.store
					.listTeamMembers(caller.agentTeamId)
					.map((member) => ({
						memberId: member.member_id,
						name: member.name,
						role: member.role,
						backendId: member.backend_id,
						lifecycle: member.lifecycle,
					}));
			case "mobvibe_team_send_message":
				return this.handleSendMessage(caller, args);
			case "mobvibe_team_spawn_member":
				return this.handleSpawnMember(caller, args);
			case "mobvibe_team_task_create":
				return this.handleCreateTask(caller, args);
			case "mobvibe_team_task_list":
				return this.handleListTasks(caller, args);
			case "mobvibe_team_task_update":
				return this.handleUpdateTask(caller, args);
		}
	}

	private async handleCreateTask(
		caller: TeamToolCaller,
		args: unknown,
	): Promise<TaskBoardResult | unknown> {
		const result = await (this.options.services?.createTask?.(caller, args) ??
			this.taskBoardService.createTaskResult(caller, args));
		this.emitProjectionChanged(caller.agentTeamId, result);
		return result;
	}

	private async handleListTasks(
		caller: TeamToolCaller,
		args: unknown,
	): Promise<TaskBoardResult | unknown> {
		return (
			this.options.services?.listTasks?.(caller, args) ??
			this.taskBoardService.listTasksResult(caller)
		);
	}

	private async handleUpdateTask(
		caller: TeamToolCaller,
		args: unknown,
	): Promise<TaskBoardResult | unknown> {
		const result = await (this.options.services?.updateTask?.(caller, args) ??
			this.taskBoardService.updateTaskResult(caller, args));
		this.emitProjectionChanged(caller.agentTeamId, result);
		return result;
	}

	private async handleSendMessage(
		caller: TeamToolCaller,
		args: unknown,
	): Promise<MailboxSendResult | unknown> {
		const parsed = parseSendMessageArgs(args);
		if (!parsed.ok) return parsed.result;

		const result = await (this.options.services?.sendMessage?.(
			caller,
			parsed.args,
		) ?? this.mailboxService.sendMessage(caller, parsed.args));
		this.emitProjectionChanged(caller.agentTeamId, result);
		return result;
	}

	private async handleSpawnMember(
		caller: TeamToolCaller,
		args: unknown,
	): Promise<SpawnMemberResult> {
		const parsed = parseSpawnMemberArgs(args);
		if (!parsed.ok) return parsed.result;
		if (!this.options.services?.spawnMember) {
			return validationError("spawn_member is not available");
		}
		const result = await this.options.services.spawnMember(caller, parsed.args);
		this.emitProjectionChanged(caller.agentTeamId, result);
		return result;
	}

	private emitProjectionChanged(agentTeamId: string, result: unknown): void {
		if (!isSuccessfulToolResult(result)) return;
		const team = this.options.store.getAgentTeam({ agentTeamId }).team;
		if (team) this.options.onAgentTeamChanged?.(team);
	}
}

function parseSendMessageArgs(
	args: unknown,
):
	| { ok: true; args: { to: string; message: string; summary?: string } }
	| { ok: false; result: MailboxSendResult } {
	if (!args || typeof args !== "object" || Array.isArray(args)) {
		return {
			ok: false,
			result: validationError("send_message args must be an object"),
		};
	}
	const record = args as Record<string, unknown>;
	if (typeof record.to !== "string" || !record.to.trim()) {
		return {
			ok: false,
			result: validationError("send_message.to must be a non-empty string"),
		};
	}
	if (typeof record.message !== "string" || !record.message.trim()) {
		return {
			ok: false,
			result: validationError(
				"send_message.message must be a non-empty string",
			),
		};
	}
	if (record.summary !== undefined && typeof record.summary !== "string") {
		return {
			ok: false,
			result: validationError("send_message.summary must be a string"),
		};
	}
	return {
		ok: true,
		args: {
			to: record.to.trim(),
			message: record.message.trim(),
			summary: record.summary?.trim() || undefined,
		},
	};
}

function validationError(
	message: string,
): MailboxSendResult & SpawnMemberResult {
	return {
		ok: false,
		error: createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message,
			retryable: false,
			scope: "request",
		}),
		deliveries: [],
	};
}

function parseSpawnMemberArgs(
	args: unknown,
):
	| { ok: true; args: { name?: string; backendId?: string } }
	| { ok: false; result: SpawnMemberResult } {
	if (args === undefined || args === null) {
		return { ok: true, args: {} };
	}
	if (typeof args !== "object" || Array.isArray(args)) {
		return {
			ok: false,
			result: validationError("spawn_member args must be an object"),
		};
	}
	const record = args as Record<string, unknown>;
	const allowedKeys = new Set(["name", "backendId"]);
	const invalidKey = Object.keys(record).find((key) => !allowedKeys.has(key));
	if (invalidKey) {
		return {
			ok: false,
			result: validationError(`spawn_member.${invalidKey} is not accepted`),
		};
	}
	if (record.name !== undefined && typeof record.name !== "string") {
		return {
			ok: false,
			result: validationError("spawn_member.name must be a string"),
		};
	}
	if (record.backendId !== undefined && typeof record.backendId !== "string") {
		return {
			ok: false,
			result: validationError("spawn_member.backendId must be a string"),
		};
	}
	return {
		ok: true,
		args: {
			name: record.name?.trim() || undefined,
			backendId: record.backendId?.trim() || undefined,
		},
	};
}

function isSuccessfulToolResult(value: unknown): value is (
	| MailboxSendResult
	| TaskBoardResult
	| SpawnMemberResult
) & {
	ok: true;
} {
	return (
		typeof value === "object" &&
		value !== null &&
		"ok" in value &&
		(value as { ok?: unknown }).ok === true
	);
}

function sanitizePayload(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const sanitized: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (forbiddenPayloadKeys.has(key)) {
			continue;
		}
		sanitized[key] = sanitizeChild(child);
	}
	return sanitized;
}

function sanitizeChild(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitizeChild);
	}
	if (value && typeof value === "object") {
		return sanitizePayload(value);
	}
	return value;
}
