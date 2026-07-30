import path from "node:path";
import {
	AppError,
	createErrorDetail,
	TEAM_RELAY_BACKEND_ID_MAX_BYTES,
	TEAM_RELAY_MACHINE_ID_MAX_BYTES,
	TEAM_RELAY_OPERATION_ID_MAX_BYTES,
} from "@mobvibe/shared";
import { buildTeamMcpServerId } from "./team-capability.js";
import type { VerifiedTeamRelayRequest } from "./team-relay-protocol.js";

export const REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES = 256;
export const REMOTE_TEAM_BOOTSTRAP_PATH_MAX_BYTES = 4096;
export const REMOTE_TEAM_BOOTSTRAP_MAX_ADDITIONAL_DIRECTORIES = 64;

const REMOTE_TEAM_BOOTSTRAP_SERVER_ID_MAX_BYTES =
	"mobvibe-team::".length + REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES * 2;
const BOOTSTRAP_PAYLOAD_KEYS = [
	"operationId",
	"agentTeamId",
	"memberId",
	"serverId",
	"backendId",
	"cwd",
	"additionalDirectories",
] as const;
const INVALID_TEXT_PATTERN = /[\p{Cc}\p{Cs}]/u;
const UTF8_ENCODER = new TextEncoder();

type RemoteTeamBootstrapPayload = {
	operationId: string;
	agentTeamId: string;
	memberId: string;
	serverId: string;
	backendId: string;
	cwd: string;
	additionalDirectories: string[];
};

export type RemoteTeamBootstrapInput = RemoteTeamBootstrapPayload & {
	leaderMachineId: string;
};

export const parseRemoteTeamBootstrapRequest = (
	request: VerifiedTeamRelayRequest,
): RemoteTeamBootstrapInput => {
	if (request.operation !== "member.bootstrap") {
		throw invalidBootstrapRequest(
			"Team relay operation must be member.bootstrap",
		);
	}
	assertBoundedIdentifier(
		request.operationId,
		TEAM_RELAY_OPERATION_ID_MAX_BYTES,
		"operationId",
	);
	assertBoundedIdentifier(
		request.sourceMachineId,
		TEAM_RELAY_MACHINE_ID_MAX_BYTES,
		"sourceMachineId",
	);

	const payload = parsePayload(request.payload);
	if (payload.operationId !== request.operationId) {
		throw invalidBootstrapRequest("Bootstrap operationId binding is invalid");
	}

	const expectedServerId = buildTeamMcpServerId({
		agentTeamId: payload.agentTeamId,
		memberId: payload.memberId,
	});
	if (payload.serverId !== expectedServerId) {
		throw invalidBootstrapRequest(
			"Bootstrap Team MCP server binding is invalid",
		);
	}

	return {
		...payload,
		additionalDirectories: [...payload.additionalDirectories],
		leaderMachineId: request.sourceMachineId,
	};
};

const parsePayload = (value: unknown): RemoteTeamBootstrapPayload => {
	if (!isRecord(value) || !hasExactKeys(value, BOOTSTRAP_PAYLOAD_KEYS)) {
		throw invalidBootstrapRequest(
			"Invalid remote Team bootstrap payload shape",
		);
	}

	assertBoundedIdentifier(
		value.operationId,
		TEAM_RELAY_OPERATION_ID_MAX_BYTES,
		"operationId",
	);
	assertBoundedIdentifier(
		value.agentTeamId,
		REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES,
		"agentTeamId",
	);
	assertBoundedIdentifier(
		value.memberId,
		REMOTE_TEAM_BOOTSTRAP_IDENTIFIER_MAX_BYTES,
		"memberId",
	);
	assertBoundedIdentifier(
		value.serverId,
		REMOTE_TEAM_BOOTSTRAP_SERVER_ID_MAX_BYTES,
		"serverId",
	);
	assertBoundedIdentifier(
		value.backendId,
		TEAM_RELAY_BACKEND_ID_MAX_BYTES,
		"backendId",
	);
	if (value.backendId.trim().length === 0) {
		throw invalidBootstrapRequest("backendId must not be blank");
	}

	const cwd = parseAbsolutePath(value.cwd, "cwd");
	const additionalDirectories = parseAdditionalDirectories(
		value.additionalDirectories,
		cwd,
	);
	return {
		operationId: value.operationId,
		agentTeamId: value.agentTeamId,
		memberId: value.memberId,
		serverId: value.serverId,
		backendId: value.backendId,
		cwd,
		additionalDirectories,
	};
};

const parseAdditionalDirectories = (value: unknown, cwd: string): string[] => {
	if (
		!Array.isArray(value) ||
		value.length > REMOTE_TEAM_BOOTSTRAP_MAX_ADDITIONAL_DIRECTORIES
	) {
		throw invalidBootstrapRequest(
			"Invalid remote Team bootstrap additionalDirectories",
		);
	}

	const seen = new Set<string>([pathComparisonKey(cwd)]);
	const directories: string[] = [];
	for (const candidate of value) {
		const directory = parseAbsolutePath(candidate, "additionalDirectories");
		const comparisonKey = pathComparisonKey(directory);
		if (seen.has(comparisonKey)) {
			throw invalidBootstrapRequest(
				"Remote Team bootstrap directories must be unique",
			);
		}
		seen.add(comparisonKey);
		directories.push(directory);
	}
	return directories;
};

const parseAbsolutePath = (value: unknown, field: string): string => {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		INVALID_TEXT_PATTERN.test(value) ||
		utf8ByteLength(value) > REMOTE_TEAM_BOOTSTRAP_PATH_MAX_BYTES ||
		(!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)) ||
		hasTraversalSegment(value)
	) {
		throw invalidBootstrapRequest(
			`${field} must contain bounded normalized absolute paths`,
		);
	}
	return value;
};

const hasTraversalSegment = (value: string): boolean =>
	value.split(/[\\/]+/).some((segment) => segment === "." || segment === "..");

const pathComparisonKey = (value: string): string => {
	if (path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)) {
		return `win32:${path.win32.normalize(value).toLocaleLowerCase("en-US")}`;
	}
	return `posix:${path.posix.normalize(value)}`;
};

function assertBoundedIdentifier(
	value: unknown,
	maxBytes: number,
	field: string,
): asserts value is string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		INVALID_TEXT_PATTERN.test(value) ||
		utf8ByteLength(value) > maxBytes
	) {
		throw invalidBootstrapRequest(`${field} is not a valid bounded identifier`);
	}
}

const utf8ByteLength = (value: string): number =>
	UTF8_ENCODER.encode(value).byteLength;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
	value: Record<string, unknown>,
	expectedKeys: readonly string[],
): boolean => {
	const actualKeys = Object.keys(value);
	return (
		actualKeys.length === expectedKeys.length &&
		expectedKeys.every((key) => Object.hasOwn(value, key))
	);
};

const invalidBootstrapRequest = (message: string): AppError =>
	new AppError(
		createErrorDetail({
			code: "REQUEST_VALIDATION_FAILED",
			message,
			retryable: false,
			scope: "request",
		}),
		400,
	);
