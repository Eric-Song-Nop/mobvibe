import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import express from "express";
import type { AcpConnectionState } from "./acp/acp-connection.js";
import {
	AppError,
	createErrorDetail,
	createInternalError,
	type ErrorDetail,
	withScope,
} from "./acp/errors.js";
import {
	type PermissionRequestPayload,
	type PermissionResultPayload,
	SessionManager,
	type SessionSummary,
} from "./acp/session-manager.js";
import { getServerConfig } from "./config.js";

const config = getServerConfig();

const sessionManager = new SessionManager({
	backends: config.acpBackends,
	defaultBackendId: config.defaultAcpBackendId,
	client: {
		name: config.clientName,
		version: config.clientVersion,
	},
});

const app = express();

const defaultCorsOrigins = new Set(["http://localhost:5173"]);
const allowedCorsOrigins = new Set([
	...defaultCorsOrigins,
	...config.corsOrigins,
]);

const isPrivateIpv4 = (hostname: string) => {
	const parts = hostname.split(".");
	if (parts.length !== 4) {
		return false;
	}
	const numbers = parts.map((part) => Number.parseInt(part, 10));
	if (
		numbers.some((value) => Number.isNaN(value) || value < 0 || value > 255)
	) {
		return false;
	}
	const [first, second] = numbers;
	if (first === 10) {
		return true;
	}
	if (first === 127) {
		return true;
	}
	if (first === 192 && second === 168) {
		return true;
	}
	if (first === 172 && second >= 16 && second <= 31) {
		return true;
	}
	return false;
};

const isAllowedCorsOrigin = (origin: string) => {
	if (allowedCorsOrigins.has(origin)) {
		return true;
	}
	try {
		const { hostname } = new URL(origin);
		if (hostname === "localhost" || hostname === "::1") {
			return true;
		}
		return isPrivateIpv4(hostname);
	} catch (error) {
		return false;
	}
};

app.use((request, response, next) => {
	const origin = request.headers.origin;
	if (origin && isAllowedCorsOrigin(origin)) {
		response.setHeader("Access-Control-Allow-Origin", origin);
		response.setHeader("Vary", "Origin");
		response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
		response.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization",
		);
	}
	if (request.method === "OPTIONS") {
		response.status(204).end();
		return;
	}
	next();
});

app.use(express.json());

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

const respondError = (
	response: express.Response,
	detail: ErrorDetail,
	status = 500,
) => {
	response.status(status).json({ error: detail });
};

const buildRequestValidationError = (message = "请求参数无效") =>
	createErrorDetail({
		code: "REQUEST_VALIDATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});

const buildSessionNotFoundError = () =>
	createErrorDetail({
		code: "SESSION_NOT_FOUND",
		message: "会话不存在",
		retryable: false,
		scope: "session",
	});

const buildSessionNotReadyError = (scope: "session" | "stream") =>
	createErrorDetail({
		code: "SESSION_NOT_READY",
		message: "会话未就绪",
		retryable: true,
		scope,
	});

type FsEntry = {
	name: string;
	path: string;
	type: "directory" | "file";
	hidden: boolean;
};

type FsRoot = {
	name: string;
	path: string;
};

type FsFilePreview = {
	path: string;
	previewType: "code" | "image";
	content: string;
	mimeType?: string;
};

type SessionFsRoot = {
	name: string;
	path: string;
};

type SessionFsRootsResponse = {
	root: SessionFsRoot;
};

const HOME_ROOT_NAME = "Home";
const SESSION_ROOT_NAME = "工作目录";
let cachedHomePath: string | undefined;

const resolveHomePath = async () => {
	if (!cachedHomePath) {
		cachedHomePath = await fs.realpath(os.homedir());
	}
	return cachedHomePath;
};

const createFsRequestError = (message: string, status = 400) =>
	new AppError(buildRequestValidationError(message), status);

const resolveFsError = (error: unknown, fallbackMessage: string) => {
	if (error instanceof AppError) {
		return error;
	}
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return createFsRequestError("路径不存在", 404);
		}
		if (code === "EACCES") {
			return createFsRequestError("没有权限访问该路径", 403);
		}
	}
	return createFsRequestError(fallbackMessage);
};

const resolveFsPath = async (input?: string) => {
	const homePath = await resolveHomePath();
	const normalized = typeof input === "string" ? input.trim() : "";
	const candidate =
		normalized.length > 0
			? path.isAbsolute(normalized)
				? normalized
				: path.join(homePath, normalized)
			: homePath;
	try {
		const resolved = await fs.realpath(candidate);
		const relative = path.relative(homePath, resolved);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw createFsRequestError("路径必须位于 Home 目录内", 403);
		}
		return resolved;
	} catch (error) {
		throw resolveFsError(error, "路径不可用");
	}
};

const resolveFsDirectory = async (input?: string) => {
	const resolved = await resolveFsPath(input);
	try {
		const stats = await fs.stat(resolved);
		if (!stats.isDirectory()) {
			throw createFsRequestError("路径必须是目录");
		}
		return resolved;
	} catch (error) {
		throw resolveFsError(error, "路径不可用");
	}
};

const createSessionFsRequestError = (message: string, status = 400) =>
	new AppError(buildRequestValidationError(message), status);

const resolveSessionRoot = (sessionId?: string) => {
	if (!sessionId) {
		throw createSessionFsRequestError("sessionId 必填");
	}
	const session = sessionManager.getSession(sessionId);
	if (!session) {
		throw new AppError(buildSessionNotFoundError(), 404);
	}
	if (!session.cwd) {
		throw createSessionFsRequestError("会话未配置工作目录");
	}
	return session.cwd;
};

const resolveSessionFsError = (error: unknown, fallbackMessage: string) => {
	if (error instanceof AppError) {
		return error;
	}
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return createSessionFsRequestError("路径不存在", 404);
		}
		if (code === "EACCES") {
			return createSessionFsRequestError("没有权限访问该路径", 403);
		}
	}
	return createSessionFsRequestError(fallbackMessage);
};

const resolveSessionPath = async (rootPath: string, input?: string) => {
	const normalized = typeof input === "string" ? input.trim() : "";
	const candidate =
		normalized.length > 0
			? path.isAbsolute(normalized)
				? normalized
				: path.join(rootPath, normalized)
			: rootPath;
	try {
		const resolved = await fs.realpath(candidate);
		const relative = path.relative(rootPath, resolved);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw createSessionFsRequestError("路径必须位于工作目录内", 403);
		}
		return resolved;
	} catch (error) {
		throw resolveSessionFsError(error, "路径不可用");
	}
};

const resolveSessionDirectory = async (rootPath: string, input?: string) => {
	const resolved = await resolveSessionPath(rootPath, input);
	try {
		const stats = await fs.stat(resolved);
		if (!stats.isDirectory()) {
			throw createSessionFsRequestError("路径必须是目录");
		}
		return resolved;
	} catch (error) {
		throw resolveSessionFsError(error, "路径不可用");
	}
};

const resolveSessionFile = async (rootPath: string, input?: string) => {
	if (!input) {
		throw createSessionFsRequestError("path 必填");
	}
	const resolved = await resolveSessionPath(rootPath, input);
	try {
		const stats = await fs.stat(resolved);
		if (!stats.isFile()) {
			throw createSessionFsRequestError("路径必须是文件");
		}
		return resolved;
	} catch (error) {
		throw resolveSessionFsError(error, "路径不可用");
	}
};

const resolveImageMimeType = (filePath: string) => {
	const extension = path.extname(filePath).toLowerCase();
	switch (extension) {
		case ".apng":
			return "image/apng";
		case ".avif":
			return "image/avif";
		case ".gif":
			return "image/gif";
		case ".jpeg":
			return "image/jpeg";
		case ".jpg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".svg":
			return "image/svg+xml";
		case ".webp":
			return "image/webp";
		default:
			return undefined;
	}
};

const readDirectoryEntries = async (dirPath: string): Promise<FsEntry[]> => {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		const resolvedEntries = await Promise.all(
			entries.map(async (entry) => {
				const entryPath = path.join(dirPath, entry.name);
				let isDirectory = entry.isDirectory();
				if (!isDirectory && entry.isSymbolicLink()) {
					try {
						const stats = await fs.stat(entryPath);
						isDirectory = stats.isDirectory();
					} catch {
						// ignore broken symlink
					}
				}
				const entryType: FsEntry["type"] = isDirectory ? "directory" : "file";
				return {
					name: entry.name,
					path: entryPath,
					type: entryType,
					hidden: entry.name.startsWith("."),
				};
			}),
		);
		return resolvedEntries.sort((left, right) => {
			if (left.type !== right.type) {
				return left.type === "directory" ? -1 : 1;
			}
			return left.name.localeCompare(right.name);
		});
	} catch (error) {
		throw resolveFsError(error, "读取目录失败");
	}
};

const parsePermissionOutcome = (
	payload: unknown,
): RequestPermissionResponse["outcome"] | null => {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const outcome = (payload as { outcome?: unknown }).outcome;
	if (outcome === "cancelled") {
		return { outcome: "cancelled" };
	}
	if (outcome === "selected") {
		const optionId = (payload as { optionId?: unknown }).optionId;
		if (typeof optionId === "string" && optionId.length > 0) {
			return { outcome: "selected", optionId };
		}
	}
	return null;
};

const resolveServiceState = (
	sessions: SessionSummary[],
): AcpConnectionState => {
	if (sessions.some((session) => session.state === "error")) {
		return "error";
	}
	if (sessions.some((session) => session.state === "connecting")) {
		return "connecting";
	}
	if (sessions.some((session) => session.state === "ready")) {
		return "ready";
	}
	if (sessions.some((session) => session.state === "stopped")) {
		return "stopped";
	}
	return "idle";
};

const resolveServiceError = (sessions: SessionSummary[]) => {
	const sessionError = sessions.find((session) => session.error)?.error;
	if (!sessionError) {
		return undefined;
	}
	return withScope(sessionError, "service");
};

const buildServiceStatus = () => {
	const sessions = sessionManager.listSessions();
	const state = resolveServiceState(sessions);
	return {
		state,
		error: resolveServiceError(sessions),
		backends: config.acpBackends.map((backend) => ({
			backendId: backend.id,
			backendLabel: backend.label,
		})),
		defaultBackendId: config.defaultAcpBackendId,
		sessionId: sessions.at(0)?.sessionId,
		pid: sessions.at(0)?.pid,
	};
};

app.get("/health", (_request, response) => {
	response.json({ ok: true });
});

app.get("/acp/agent", (_request, response) => {
	response.json(buildServiceStatus());
});

app.get("/acp/backends", (_request, response) => {
	response.json({
		defaultBackendId: config.defaultAcpBackendId,
		backends: config.acpBackends.map((backend) => ({
			backendId: backend.id,
			backendLabel: backend.label,
		})),
	});
});

app.get("/fs/roots", async (_request, response) => {
	try {
		const homePath = await resolveHomePath();
		const roots: FsRoot[] = [{ name: HOME_ROOT_NAME, path: homePath }];
		response.json({ homePath, roots });
	} catch (error) {
		respondError(
			response,
			createInternalError("request", getErrorMessage(error)),
		);
	}
});

app.get("/fs/entries", async (request, response) => {
	const queryPath = request.query.path;
	const requestPath = typeof queryPath === "string" ? queryPath : undefined;
	try {
		const resolvedPath = await resolveFsDirectory(requestPath);
		const entries = await readDirectoryEntries(resolvedPath);
		response.json({ path: resolvedPath, entries });
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("request", getErrorMessage(error)),
		);
	}
});

app.get("/fs/session/roots", (request, response) => {
	const sessionId =
		typeof request.query.sessionId === "string"
			? request.query.sessionId
			: undefined;
	try {
		const rootPath = resolveSessionRoot(sessionId);
		const payload: SessionFsRootsResponse = {
			root: {
				name: SESSION_ROOT_NAME,
				path: rootPath,
			},
		};
		response.json(payload);
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("request", getErrorMessage(error)),
		);
	}
});

app.get("/fs/session/entries", async (request, response) => {
	const sessionId =
		typeof request.query.sessionId === "string"
			? request.query.sessionId
			: undefined;
	const queryPath = request.query.path;
	const requestPath = typeof queryPath === "string" ? queryPath : undefined;
	try {
		const rootPath = resolveSessionRoot(sessionId);
		const resolvedPath = await resolveSessionDirectory(rootPath, requestPath);
		const entries = await readDirectoryEntries(resolvedPath);
		response.json({ path: resolvedPath, entries });
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("request", getErrorMessage(error)),
		);
	}
});

app.get("/fs/session/file", async (request, response) => {
	const sessionId =
		typeof request.query.sessionId === "string"
			? request.query.sessionId
			: undefined;
	const queryPath = request.query.path;
	const requestPath = typeof queryPath === "string" ? queryPath : undefined;
	try {
		const rootPath = resolveSessionRoot(sessionId);
		const resolvedPath = await resolveSessionFile(rootPath, requestPath);
		const mimeType = resolveImageMimeType(resolvedPath);
		if (mimeType) {
			const buffer = await fs.readFile(resolvedPath);
			const payload: FsFilePreview = {
				path: resolvedPath,
				previewType: "image",
				content: `data:${mimeType};base64,${buffer.toString("base64")}`,
				mimeType,
			};
			response.json(payload);
			return;
		}
		const content = await fs.readFile(resolvedPath, "utf8");
		const payload: FsFilePreview = {
			path: resolvedPath,
			previewType: "code",
			content,
		};
		response.json(payload);
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("request", getErrorMessage(error)),
		);
	}
});

app.get("/acp/sessions", (_request, response) => {
	response.json({ sessions: sessionManager.listSessions() });
});

app.post("/acp/session", async (request, response) => {
	try {
		const { cwd, title, backendId } = request.body ?? {};
		const rawCwd =
			typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined;
		const resolvedCwd = rawCwd ? await resolveFsDirectory(rawCwd) : undefined;
		const session = await sessionManager.createSession({
			cwd: resolvedCwd,
			title:
				typeof title === "string" && title.trim().length > 0
					? title.trim()
					: undefined,
			backendId: typeof backendId === "string" ? backendId : undefined,
		});
		response.json(session);
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("service", getErrorMessage(error)),
		);
	}
});

app.patch("/acp/session", (request, response) => {
	const { sessionId, title } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof title !== "string") {
		respondError(
			response,
			buildRequestValidationError("sessionId 和 title 必填"),
			400,
		);
		return;
	}

	try {
		const summary = sessionManager.updateTitle(sessionId, title.trim());
		response.json({ sessionId: summary.sessionId, title: summary.title });
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
			500,
		);
	}
});

app.post("/acp/session/close", async (request, response) => {
	const { sessionId } = request.body ?? {};
	if (typeof sessionId !== "string") {
		respondError(response, buildRequestValidationError("sessionId 必填"), 400);
		return;
	}

	try {
		await sessionManager.closeSession(sessionId);
		response.json({ ok: true });
	} catch (error) {
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
		);
	}
});

app.post("/acp/session/cancel", async (request, response) => {
	const { sessionId } = request.body ?? {};
	if (typeof sessionId !== "string") {
		respondError(response, buildRequestValidationError("sessionId 必填"), 400);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("session"), 409);
		return;
	}

	try {
		const cancelled = await sessionManager.cancelSession(sessionId);
		if (!cancelled) {
			respondError(response, buildSessionNotFoundError(), 404);
			return;
		}
		response.json({ ok: true });
	} catch (error) {
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
		);
	}
});

app.post("/acp/session/mode", async (request, response) => {
	const { sessionId, modeId } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof modeId !== "string") {
		respondError(
			response,
			buildRequestValidationError("sessionId 和 modeId 必填"),
			400,
		);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("session"), 409);
		return;
	}

	try {
		const summary = await sessionManager.setSessionMode(sessionId, modeId);
		response.json(summary);
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
		);
	}
});

app.post("/acp/session/model", async (request, response) => {
	const { sessionId, modelId } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof modelId !== "string") {
		respondError(
			response,
			buildRequestValidationError("sessionId 和 modelId 必填"),
			400,
		);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("session"), 409);
		return;
	}

	try {
		const summary = await sessionManager.setSessionModel(sessionId, modelId);
		response.json(summary);
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
		);
	}
});

app.post("/acp/message/id", async (request, response) => {
	const { sessionId } = request.body ?? {};
	if (typeof sessionId !== "string") {
		respondError(response, buildRequestValidationError("sessionId 必填"), 400);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("session"), 409);
		return;
	}

	response.json({ messageId: crypto.randomUUID() });
});

app.post("/acp/message", async (request, response) => {
	const { sessionId, prompt } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof prompt !== "string") {
		respondError(
			response,
			buildRequestValidationError("sessionId 和 prompt 必填"),
		);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("session"), 409);
		return;
	}

	try {
		sessionManager.touchSession(sessionId);
		const result = await record.connection.prompt(sessionId, [
			{ type: "text", text: prompt },
		]);
		sessionManager.touchSession(sessionId);
		response.json({ stopReason: result.stopReason });
	} catch (error) {
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
		);
	}
});

app.post("/acp/permission/decision", (request, response) => {
	const { sessionId, requestId, outcome } = request.body ?? {};
	if (typeof sessionId !== "string" || typeof requestId !== "string") {
		respondError(
			response,
			buildRequestValidationError("sessionId 和 requestId 必填"),
			400,
		);
		return;
	}
	const parsedOutcome = parsePermissionOutcome(outcome);
	if (!parsedOutcome) {
		respondError(response, buildRequestValidationError("outcome 不合法"), 400);
		return;
	}

	try {
		const result = sessionManager.resolvePermissionRequest(
			sessionId,
			requestId,
			parsedOutcome,
		);
		response.json(result);
	} catch (error) {
		if (error instanceof AppError) {
			respondError(response, error.detail, error.status);
			return;
		}
		respondError(
			response,
			createInternalError("session", getErrorMessage(error)),
			500,
		);
	}
});

app.get("/acp/session/stream", (request, response) => {
	const sessionId = request.query.sessionId;
	if (typeof sessionId !== "string" || sessionId.length === 0) {
		respondError(response, buildRequestValidationError("sessionId 必填"), 400);
		return;
	}

	const record = sessionManager.getSession(sessionId);
	if (!record) {
		respondError(response, buildSessionNotFoundError(), 404);
		return;
	}

	const status = record.connection.getStatus();
	if (status.state !== "ready") {
		respondError(response, buildSessionNotReadyError("stream"), 409);
		return;
	}

	response.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	response.write("event: ready\ndata: {}\n\n");

	const sendUpdate = (notification: { sessionId: string }) => {
		if (notification.sessionId !== sessionId) {
			return;
		}
		response.write(
			`event: session_update\ndata: ${JSON.stringify(notification)}\n\n`,
		);
	};

	const sendError = (detail: ErrorDetail) => {
		response.write(
			`event: session_error\ndata: ${JSON.stringify({
				sessionId,
				error: withScope(detail, "stream"),
			})}\n\n`,
		);
	};

	const sendPermissionRequest = (payload: PermissionRequestPayload) => {
		if (payload.sessionId !== sessionId) {
			return;
		}
		response.write(
			`event: permission_request\ndata: ${JSON.stringify(payload)}\n\n`,
		);
	};

	const sendPermissionResult = (payload: PermissionResultPayload) => {
		if (payload.sessionId !== sessionId) {
			return;
		}
		response.write(
			`event: permission_result\ndata: ${JSON.stringify(payload)}\n\n`,
		);
	};

	const sendTerminalOutput = (payload: {
		sessionId: string;
		terminalId: string;
		delta: string;
		truncated: boolean;
		output?: string;
		exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
	}) => {
		if (payload.sessionId !== sessionId) {
			return;
		}
		response.write(
			`event: terminal_output\ndata: ${JSON.stringify(payload)}\n\n`,
		);
	};

	const unsubscribe = record.connection.onSessionUpdate(sendUpdate);
	const unsubscribeStatus = record.connection.onStatusChange((nextStatus) => {
		if (nextStatus.state === "error" && nextStatus.error) {
			sendError(nextStatus.error);
		}
	});
	const unsubscribePermissionRequest = sessionManager.onPermissionRequest(
		sendPermissionRequest,
	);
	const unsubscribePermissionResult =
		sessionManager.onPermissionResult(sendPermissionResult);
	const unsubscribeTerminalOutput =
		record.connection.onTerminalOutput(sendTerminalOutput);
	const pendingPermissions = sessionManager.listPendingPermissions(sessionId);
	pendingPermissions.forEach((payload) => {
		sendPermissionRequest(payload);
	});
	const ping = setInterval(() => {
		response.write("event: ping\ndata: {}\n\n");
	}, 15000);

	request.on("close", () => {
		clearInterval(ping);
		unsubscribe();
		unsubscribeStatus();
		unsubscribePermissionRequest();
		unsubscribePermissionResult();
		unsubscribeTerminalOutput();
	});
});

const shouldStartServer = process.env.NODE_ENV !== "test";
let server: ReturnType<typeof app.listen> | undefined;

const stopServer = async () =>
	new Promise<void>((resolve, reject) => {
		if (!server) {
			resolve();
			return;
		}
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

const shutdown = async (signal: string) => {
	console.log(`[mobvibe] received ${signal}, shutting down`);
	try {
		await sessionManager.closeAll();
		await stopServer();
	} catch (error) {
		console.error("[mobvibe] shutdown error", error);
	}
};

if (shouldStartServer) {
	server = app.listen(config.port, () => {
		console.log(`[mobvibe] backend listening on :${config.port}`);
	});

	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});

	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
}

export { app };
