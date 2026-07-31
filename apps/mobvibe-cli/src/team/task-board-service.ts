import {
	createErrorDetail,
	type ErrorDetail,
	type TeamTaskStatus,
} from "@mobvibe/shared";
import type {
	AgentTeamStore,
	AgentTeamTaskLocalRow,
	TeamTaskLocalBody,
} from "./agent-team-store.js";
import type { AgentTeamMemberRow } from "./projection-builder.js";
import type { TeamToolCaller } from "./team-tool-handlers.js";

export type TaskBoardTask = {
	taskId: string;
	agentTeamId: string;
	ownerMemberId?: string;
	ownerName?: string;
	status: TeamTaskStatus;
	title: string;
	description?: string;
	blockedBy: string[];
	blocks: string[];
	createdAt: string;
	updatedAt: string;
};

export type TaskBoardResult =
	| { ok: true; agentTeamId: string; task: TaskBoardTask }
	| { ok: true; agentTeamId: string; tasks: TaskBoardTask[] }
	| { ok: false; error: ErrorDetail };

export class TaskBoardService {
	constructor(private readonly store: AgentTeamStore) {}

	createTask(
		caller: TeamToolCaller,
		args: {
			title: string;
			description?: string;
			owner?: string;
			status?: unknown;
			blockedBy?: string[];
		},
	): TaskBoardTask {
		const status = parseTaskStatus(args.status ?? "todo");
		const blockedBy = uniqueStrings(args.blockedBy ?? []);
		const members = this.store.listTeamMembers(caller.agentTeamId);
		const owner = resolveMember(members, args.owner ?? caller.memberId);
		const row = this.store.createTeamTask({
			agentTeamId: caller.agentTeamId,
			ownerMemberId: owner.member_id,
			status: blockedBy.length > 0 ? "blocked" : status,
			body: {
				title: requireNonEmpty(args.title, "task.title"),
				description: args.description,
			},
			blockedBy,
		});
		return rowToTask(row, members);
	}

	listTasks(caller: TeamToolCaller): TaskBoardTask[] {
		const members = this.store.listTeamMembers(caller.agentTeamId);
		return this.store
			.listLocalTasks(caller.agentTeamId)
			.map((row) => rowToTask(row, members));
	}

	updateTask(
		caller: TeamToolCaller,
		args: {
			taskId: string;
			status?: unknown;
			owner?: string;
			title?: string;
			description?: string;
			blockedBy?: string[];
		},
	): TaskBoardTask {
		const members = this.store.listTeamMembers(caller.agentTeamId);
		const owner = args.owner ? resolveMember(members, args.owner) : undefined;
		const body = buildBodyPatch(args);
		const row = this.store.updateTeamTask({
			agentTeamId: caller.agentTeamId,
			taskId: requireNonEmpty(args.taskId, "task.taskId"),
			ownerMemberId: owner?.member_id,
			status:
				args.status === undefined ? undefined : parseTaskStatus(args.status),
			body,
			blockedBy: args.blockedBy ? uniqueStrings(args.blockedBy) : undefined,
		});
		return rowToTask(row, members);
	}

	createTaskResult(caller: TeamToolCaller, args: unknown): TaskBoardResult {
		try {
			return {
				ok: true,
				agentTeamId: caller.agentTeamId,
				task: this.createTask(caller, parseCreateArgs(args)),
			};
		} catch (error) {
			return validationResult(error);
		}
	}

	listTasksResult(caller: TeamToolCaller): TaskBoardResult {
		return {
			ok: true,
			agentTeamId: caller.agentTeamId,
			tasks: this.listTasks(caller),
		};
	}

	updateTaskResult(caller: TeamToolCaller, args: unknown): TaskBoardResult {
		try {
			return {
				ok: true,
				agentTeamId: caller.agentTeamId,
				task: this.updateTask(caller, parseUpdateArgs(args)),
			};
		} catch (error) {
			return validationResult(error);
		}
	}
}

const taskStatuses: TeamTaskStatus[] = [
	"todo",
	"in_progress",
	"blocked",
	"completed",
	"failed",
	"cancelled",
];

function parseTaskStatus(value: unknown): TeamTaskStatus {
	if (
		typeof value === "string" &&
		taskStatuses.includes(value as TeamTaskStatus)
	) {
		return value as TeamTaskStatus;
	}
	throw new Error(`Invalid task status: ${String(value)}`);
}

function parseCreateArgs(args: unknown): {
	title: string;
	description?: string;
	owner?: string;
	status?: unknown;
	blockedBy?: string[];
} {
	const record = requireRecord(args, "task_create args");
	return {
		title: readRequiredString(record, "title"),
		description: readOptionalString(record, "description"),
		owner: readOptionalString(record, "owner"),
		status: record.status,
		blockedBy: readOptionalStringArray(record, "blockedBy"),
	};
}

function parseUpdateArgs(args: unknown): {
	taskId: string;
	status?: unknown;
	owner?: string;
	title?: string;
	description?: string;
	blockedBy?: string[];
} {
	const record = requireRecord(args, "task_update args");
	return {
		taskId: readRequiredString(record, "taskId"),
		status: record.status,
		owner: readOptionalString(record, "owner"),
		title: readOptionalString(record, "title"),
		description: readOptionalString(record, "description"),
		blockedBy: readOptionalStringArray(record, "blockedBy"),
	};
}

function rowToTask(
	row: AgentTeamTaskLocalRow,
	members: AgentTeamMemberRow[],
): TaskBoardTask {
	const body = parseTaskBody(row.body_local_json);
	const owner = members.find(
		(member) => member.member_id === row.owner_member_id,
	);
	return {
		taskId: row.task_id,
		agentTeamId: row.agent_team_id,
		ownerMemberId: row.owner_member_id ?? undefined,
		ownerName: owner?.name,
		status: parseTaskStatus(row.status),
		title: body.title,
		description: body.description,
		blockedBy: parseStringArray(row.blocked_by_json),
		blocks: parseStringArray(row.blocks_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function resolveMember(
	members: AgentTeamMemberRow[],
	memberRef: string,
): AgentTeamMemberRow {
	const normalized = normalizeName(memberRef);
	const member = members.find(
		(candidate) =>
			candidate.member_id === memberRef ||
			normalizeName(candidate.name) === normalized,
	);
	if (!member) throw new Error(`Unknown task owner: ${memberRef}`);
	return member;
}

function buildBodyPatch(args: {
	title?: string;
	description?: string;
}): Partial<TeamTaskLocalBody> | undefined {
	const body: Partial<TeamTaskLocalBody> = {};
	if (args.title !== undefined)
		body.title = requireNonEmpty(args.title, "task.title");
	if (args.description !== undefined) body.description = args.description;
	return Object.keys(body).length ? body : undefined;
}

function validationResult(error: unknown): TaskBoardResult {
	return {
		ok: false,
		error: createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message: error instanceof Error ? error.message : "Invalid task args",
			retryable: false,
			scope: "request",
		}),
	};
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function readRequiredString(
	record: Record<string, unknown>,
	key: string,
): string {
	return requireNonEmpty(record[key], `task.${key}`);
}

function readOptionalString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	if (record[key] === undefined) return undefined;
	if (typeof record[key] !== "string")
		throw new Error(`task.${key} must be a string`);
	return record[key].trim() || undefined;
}

function readOptionalStringArray(
	record: Record<string, unknown>,
	key: string,
): string[] | undefined {
	if (record[key] === undefined) return undefined;
	const value = record[key];
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string")
	) {
		throw new Error(`task.${key} must be a string array`);
	}
	return uniqueStrings(value);
}

function requireNonEmpty(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value.trim();
}

function parseTaskBody(value: string): TeamTaskLocalBody {
	const parsed = JSON.parse(value) as unknown;
	const record =
		parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: {};
	return {
		title: typeof record.title === "string" ? record.title : "",
		description:
			typeof record.description === "string" ? record.description : undefined,
	};
}

function parseStringArray(value: string | null): string[] {
	if (!value) return [];
	const parsed = JSON.parse(value) as unknown;
	return Array.isArray(parsed)
		? parsed.filter((item): item is string => typeof item === "string")
		: [];
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeName(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}
