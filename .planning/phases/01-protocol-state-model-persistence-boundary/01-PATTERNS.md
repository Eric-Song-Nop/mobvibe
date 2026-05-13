# Phase 01: 协议、状态模型与持久化边界 - Pattern Map

**Mapped:** 2026-05-13  
**Files analyzed:** 21  
**Analogs found:** 21 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/shared/src/types/agent-team.ts` | model | transform | `packages/shared/src/types/session.ts` | role-match |
| `packages/shared/src/types/session.ts` | model | transform | `packages/shared/src/types/session.ts` | exact-modify |
| `packages/shared/src/types/errors.ts` | model | transform | `packages/shared/src/types/errors.ts` | exact-modify |
| `packages/shared/src/types/socket-events.ts` | model | event-driven / request-response | `packages/shared/src/types/socket-events.ts` | exact-modify |
| `packages/shared/src/index.ts` | config | transform | `packages/shared/src/index.ts` | exact-modify |
| `apps/mobvibe-cli/src/wal/migrations.ts` | migration | CRUD | `apps/mobvibe-cli/src/wal/migrations.ts` | exact-modify |
| `apps/mobvibe-cli/src/team/agent-team-store.ts` | service | CRUD | `apps/mobvibe-cli/src/wal/wal-store.ts` | role-match |
| `apps/mobvibe-cli/src/team/projection-builder.ts` | service | transform | `apps/mobvibe-cli/src/wal/wal-store.ts` | partial-match |
| `apps/mobvibe-cli/src/team/content-boundary.ts` | utility | transform | `apps/gateway/src/routes/sessions.ts` | partial-match |
| `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts` | test | CRUD | `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts` | role-match |
| `apps/mobvibe-cli/src/team/__tests__/projection-builder.test.ts` | test | transform | `apps/mobvibe-cli/src/daemon/__tests__/socket-client.test.ts` | role-match |
| `apps/mobvibe-cli/src/daemon/socket-client.ts` | service | event-driven / request-response | `packages/shared/src/types/socket-events.ts` | partial-match |
| `apps/gateway/src/services/team-router.ts` | service | request-response | `apps/gateway/src/services/session-router.ts` | exact-role |
| `apps/gateway/src/routes/agent-teams.ts` | route | request-response | `apps/gateway/src/routes/sessions.ts` | exact-role |
| `apps/gateway/src/socket/cli-handlers.ts` | service | event-driven | `apps/gateway/src/socket/cli-handlers.ts` | exact-modify |
| `apps/gateway/src/index.ts` | config | request-response | `apps/gateway/src/routes/sessions.ts` | role-match |
| `apps/gateway/src/services/__tests__/team-router.test.ts` | test | request-response | `apps/gateway/src/services/session-router.ts` | role-match |
| `apps/gateway/src/routes/__tests__/agent-teams.test.ts` | test | request-response | `apps/gateway/src/routes/sessions.ts` | role-match |
| `apps/webui/src/lib/api.ts` | service | request-response | `apps/webui/src/lib/api.ts` | exact-modify |
| `apps/webui/src/lib/team-store.ts` | store | event-driven / transform | `apps/webui/src/lib/chat-store.ts` | role-match |
| `apps/webui/src/lib/socket.ts` | service | event-driven | `apps/webui/src/lib/socket.ts` | exact-modify |

## Pattern Assignments

### `packages/shared/src/types/agent-team.ts`（model, transform）

**Analog:** `packages/shared/src/types/session.ts`

**Imports pattern**（lines 1-2）:
```typescript
import type { AvailableCommand } from "./acp.js";
import type { ErrorDetail } from "./errors.js";
```

**类型文件组织 pattern**（lines 11-18, 31-67）:
```typescript
export type AcpBackendId = string;

export type AcpBackendSummary = {
	backendId: string;
	backendLabel: string;
	icon?: string;
	description?: string;
};

export type SessionSummary = {
	sessionId: string;
	title: string;
	backendId: string;
	backendLabel: string;
	error?: ErrorDetail;
	pid?: number;
	createdAt: string;
	updatedAt: string;
	cwd?: string;
	/** Stable workspace/project root for grouping and navigation */
	workspaceRootCwd?: string;
	// ...更多 gateway-facing metadata 字段
};
```

**应用到:** 新的 `AgentTeamId` / `TeamMemberId` 字符串别名、`AgentTeamSummary`、`TeamMemberSummary`、`TeamMcpStatusSummary`、counts/source refs。保持 `ErrorDetail` 复用，不把正文类字段放进 summary/projection。

---

### `packages/shared/src/types/session.ts`（model, transform）

**Analog:** `packages/shared/src/types/session.ts`

**Capability pattern**（lines 122-133）:
```typescript
/** Agent session capabilities */
export type AgentPromptCapabilities = {
	image?: boolean;
	audio?: boolean;
	embeddedContext?: boolean;
};

export type AgentSessionCapabilities = {
	list: boolean;
	load: boolean;
	prompt?: AgentPromptCapabilities;
};
```

**应用到:** 在该文件扩展 `AgentSessionCapabilities`，新增嵌套 `mcp?: AgentMcpCapabilities` 或等价字段，表达 `acp`、`stdio`、`perSessionBridge`。不要把 MCP readiness 写入 `SessionSummary` lifecycle；team readiness 应在 `agent-team.ts` 中建模。

---

### `packages/shared/src/types/errors.ts`（model, transform）

**Analog:** `packages/shared/src/types/errors.ts`

**Error shape pattern**（lines 1-23）:
```typescript
export type ErrorScope = "service" | "session" | "stream" | "request";

export type ErrorCode =
	| "ACP_CONNECT_FAILED"
	| "ACP_PROCESS_EXITED"
	| "ACP_CONNECTION_CLOSED"
	| "ACP_PROTOCOL_MISMATCH"
	| "SESSION_NOT_FOUND"
	| "SESSION_NOT_READY"
	| "CAPABILITY_NOT_SUPPORTED"
	| "REQUEST_VALIDATION_FAILED"
	| "AUTHORIZATION_FAILED"
	| "STREAM_DISCONNECTED"
	| "GIT_WORKTREE_FAILED"
	| "INTERNAL_ERROR";

export type ErrorDetail = {
	code: ErrorCode;
	message: string;
	retryable: boolean;
	scope: ErrorScope;
	detail?: string;
};
```

**Helper pattern**（lines 29-52, 65-74）:
```typescript
export const createErrorDetail = (input: ErrorDetailInput): ErrorDetail => ({
	...input,
});

export const createInternalError = (
	scope: ErrorScope,
	detail?: string,
): ErrorDetail =>
	createErrorDetail({
		code: "INTERNAL_ERROR",
		message: "Internal server error",
		retryable: true,
		scope,
		detail,
	});

export class AppError extends Error {
	readonly detail: ErrorDetail;
	readonly status: number;
}
```

**应用到:** 如需 team/member/MCP 错误码，扩展 union；不要新增 ad-hoc `{ ok, error: string }`。Gateway 与 CLI RPC 统一返回 `ErrorDetail`。

---

### `packages/shared/src/types/socket-events.ts`（model, event-driven / request-response）

**Analog:** `packages/shared/src/types/socket-events.ts`

**RPC wrapper pattern**（lines 122-133）:
```typescript
export type RpcRequest<TParams> = {
	requestId: string;
	params: TParams;
};

export type RpcResponse<TResult> = {
	requestId: string;
	result?: TResult;
	error?: ErrorDetail;
};
```

**Event interface pattern**（lines 289-306, 308-366, 374-385）:
```typescript
export interface CliToGatewayEvents {
	"cli:register": (info: CliRegistrationInfo) => void;
	"sessions:changed": (payload: SessionsChangedPayload) => void;
	"sessions:discovered": (payload: SessionsDiscoveredPayload) => void;
	"rpc:response": (response: RpcResponse<unknown>) => void;
}

export interface GatewayToCliEvents {
	"rpc:session:create": (request: RpcRequest<CreateSessionParams>) => void;
	"rpc:sessions:discover": (
		request: RpcRequest<DiscoverSessionsRpcParams>,
	) => void;
}

export interface GatewayToWebuiEvents {
	"session:event": (event: SessionEvent) => void;
	"cli:status": (payload: CliStatusPayload) => void;
	"sessions:changed": (payload: SessionsChangedPayload) => void;
}
```

**应用到:** 新增 `CreateAgentTeamParams/Result`、`ListAgentTeamsResult`、`GetAgentTeamParams/Result`，并把 `rpc:agent-team:create`、`rpc:agent-teams:list`、`rpc:agent-team:get` 与 `agent-teams:changed` 放入同一 typed event 文件。

---

### `packages/shared/src/index.ts`（config, transform）

**Analog:** `packages/shared/src/index.ts`

**显式 export pattern**（lines 113-127, 137-155, 156-243）:
```typescript
export type {
	ErrorCode,
	ErrorDetail,
	ErrorDetailInput,
	ErrorScope,
} from "./types/errors.js";
export {
	AppError,
	createErrorDetail,
	createInternalError,
	isErrorDetail,
	isProtocolMismatch,
	withScope,
} from "./types/errors.js";

export type {
	AcpBackendId,
	AcpBackendSummary,
	AcpConnectionState,
	AcpSessionInfo,
	AgentPromptCapabilities,
	AgentSessionCapabilities,
	SessionSummary,
	SessionsChangedPayload,
} from "./types/session.js";
```

**应用到:** 新增 `agent-team.ts` 后在 index 中显式导出所有跨包公共类型；不要依赖 barrel 自动导出。

---

### `apps/mobvibe-cli/src/wal/migrations.ts`（migration, CRUD）

**Analog:** `apps/mobvibe-cli/src/wal/migrations.ts`

**Migration array pattern**（lines 3-45, 47-67, 113-123）:
```typescript
const MIGRATIONS = [
	{
		version: 1,
		up: `
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        current_revision INTEGER NOT NULL DEFAULT 1,
        cwd TEXT,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
	},
	{
		version: 6,
		up: `
      ALTER TABLE discovered_sessions ADD COLUMN workspace_root_cwd TEXT;
    `,
	},
];
```

**Run pattern**（lines 125-149）:
```typescript
export function runMigrations(db: Database): void {
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");

	let currentVersion = 0;
	try {
		const result = db
			.query("SELECT MAX(version) as version FROM schema_version")
			.get() as { version: number | null } | null;
		currentVersion = result?.version ?? 0;
	} catch {
		// Table doesn't exist yet, version is 0
	}

	for (const migration of MIGRATIONS) {
		if (migration.version > currentVersion) {
			db.exec(migration.up);
			db.exec(
				`INSERT INTO schema_version (version) VALUES (${migration.version})`,
			);
		}
	}
}
```

**应用到:** Agent Team tables 应作为下一个 migration version 加入同一 `MIGRATIONS`，复用 WAL pragma 与 `schema_version`，不要新增第二套 migration 系统。

---

### `apps/mobvibe-cli/src/team/agent-team-store.ts`（service, CRUD）

**Analog:** `apps/mobvibe-cli/src/wal/wal-store.ts`

**Imports / constructor pattern**（lines 1-7, 69-111）:
```typescript
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { SessionEventKind } from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
import { runMigrations } from "./migrations.js";

export class WalStore {
	private db: Database;

	constructor(dbPath: string) {
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(dbPath);
		runMigrations(this.db);
		// Prepare statements
	}
}
```

**Prepared statement + CRUD pattern**（lines 73-90, 193-210, 542-570）:
```typescript
private stmtUpsertDiscoveredSession: ReturnType<Database["query"]>;
private stmtGetDiscoveredSessions: ReturnType<Database["query"]>;
private stmtGetDiscoveredSessionsByBackend: ReturnType<Database["query"]>;

this.stmtUpsertDiscoveredSession = this.db.query(`
  INSERT INTO discovered_sessions (
    session_id, backend_id, cwd, workspace_root_cwd, title, agent_updated_at,
    discovered_at, last_verified_at, is_stale
  ) VALUES (
    $sessionId, $backendId, $cwd, $workspaceRootCwd, $title, $agentUpdatedAt,
    $discoveredAt, $lastVerifiedAt, 0
  )
  ON CONFLICT (session_id) DO UPDATE SET
    backend_id = $backendId,
    cwd = COALESCE($cwd, discovered_sessions.cwd),
    workspace_root_cwd = COALESCE($workspaceRootCwd, discovered_sessions.workspace_root_cwd),
    title = COALESCE($title, discovered_sessions.title),
    agent_updated_at = COALESCE($agentUpdatedAt, discovered_sessions.agent_updated_at),
    last_verified_at = $lastVerifiedAt,
    is_stale = 0
`);

saveDiscoveredSessions(sessions: DiscoveredSession[]): void {
	const now = new Date().toISOString();
	for (const session of sessions) {
		this.stmtUpsertDiscoveredSession.run({
			$sessionId: session.sessionId,
			$backendId: session.backendId,
			$cwd: session.cwd ?? null,
			$workspaceRootCwd: session.workspaceRootCwd ?? null,
			$title: session.title ?? null,
			$agentUpdatedAt: session.agentUpdatedAt ?? null,
			$discoveredAt: session.discoveredAt,
			$lastVerifiedAt: now,
		});
	}
}
```

**Row mapping pattern**（lines 678-690, 717-727）:
```typescript
private rowToDiscoveredSession(row: DiscoveredSessionRow): DiscoveredSession {
	return {
		sessionId: row.session_id,
		backendId: row.backend_id,
		cwd: row.cwd ?? undefined,
		workspaceRootCwd: row.workspace_root_cwd ?? undefined,
		title: row.title ?? undefined,
		agentUpdatedAt: row.agent_updated_at ?? undefined,
		discoveredAt: row.discovered_at,
		lastVerifiedAt: row.last_verified_at ?? undefined,
		isStale: row.is_stale === 1,
	};
}
```

**应用到:** `AgentTeamStore` 使用 Bun `Database`、prepared statements、`$param` bind、snake_case row → camelCase projection mapping、`logger` 只记录 IDs/count/status。

---

### `apps/mobvibe-cli/src/team/projection-builder.ts`（service, transform）

**Analog:** `apps/mobvibe-cli/src/wal/wal-store.ts`

**Transform pattern**（lines 651-690）:
```typescript
private rowToSession(row: WalSessionRow): WalSession {
	return {
		sessionId: row.session_id,
		machineId: row.machine_id,
		backendId: row.backend_id,
		currentRevision: row.current_revision,
		cwd: row.cwd ?? undefined,
		title: row.title ?? undefined,
		isTitlePinned: row.is_title_pinned === 1 ? true : undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

private rowToEvent(row: WalEventRow): WalEvent {
	return {
		id: row.id,
		sessionId: row.session_id,
		revision: row.revision,
		seq: row.seq,
		kind: row.kind as SessionEventKind,
		payload: JSON.parse(row.payload),
		createdAt: row.created_at,
		ackedAt: row.acked_at ?? undefined,
	};
}
```

**应用到:** Projection builder 应只输出 `AgentTeamSummary` / counts / source refs / error code。对 `source_refs_json`、`blocked_by_json`、`blocks_json` 使用 `JSON.parse` 后做类型收窄；永远不要把 `body_local_json` 传出。

---

### `apps/mobvibe-cli/src/team/content-boundary.ts`（utility, transform）

**Analog:** `apps/gateway/src/routes/sessions.ts`

**Validation error pattern**（lines 36-50）:
```typescript
const buildRequestValidationError = (message = "Invalid request") =>
	createErrorDetail({
		code: "REQUEST_VALIDATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});
```

**Encrypted content boundary pattern**（lines 459-469, 482-489）:
```typescript
const { sessionId, prompt } = request.body ?? {};
if (typeof sessionId !== "string" || !isEncryptedPayload(prompt)) {
	respondError(
		response,
		buildRequestValidationError("sessionId and prompt required"),
		400,
	);
	return;
}

logger.info(
	{
		sessionId,
		userId,
		promptBlocks: "encrypted",
		requestId,
	},
	"message_send_request",
);
```

**应用到:** content-boundary helper 应拒绝 `prompt/content/body/description/summaryText/agentOutput` 明文字段；如确需内容，只允许 `EncryptedPayload` 或 CLI-local `body_local_json`，日志用 `"encrypted"` / counts，不记录正文。

---

### `apps/gateway/src/services/team-router.ts`（service, request-response）

**Analog:** `apps/gateway/src/services/session-router.ts`

**Imports / pending RPC pattern**（lines 1-68）:
```typescript
import { randomUUID } from "node:crypto";
import type {
	CreateSessionParams,
	RpcRequest,
	RpcResponse,
	SessionSummary,
} from "@mobvibe/shared";
import type { Socket } from "socket.io";
import { logger } from "../lib/logger.js";
import type { CliRecord, CliRegistry } from "./cli-registry.js";

type PendingRpc<T> = {
	requestId: string;
	resolve: (result: T) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
};

const RPC_TIMEOUT = 120000;
```

**Ownership + no-leak pattern**（lines 89-101）:
```typescript
private resolveMachineForUser(machineId: string, userId: string): CliRecord {
	const cli = this.cliRegistry.getCliByMachineIdForUser(machineId, userId);
	if (!cli) {
		throw new Error("Machine not found");
	}
	return cli;
}
```

**sendRpc pattern**（lines 1111-1155）:
```typescript
private sendRpc<TParams, TResult>(
	socket: Socket,
	event: string,
	params: TParams,
): Promise<TResult> {
	return new Promise((resolve, reject) => {
		const requestId = randomUUID();
		const timeout = setTimeout(() => {
			this.pendingRpcs.delete(requestId);
			reject(new Error("RPC timeout"));
		}, RPC_TIMEOUT);

		this.pendingRpcs.set(requestId, {
			requestId,
			resolve: (result) => resolve(result as TResult),
			reject: (error) => reject(error as Error),
			timeout,
		});

		const request: RpcRequest<TParams> = { requestId, params };
		logger.debug({ requestId, event }, "rpc_request_sent");
		socket.emit(event, request);
	});
}
```

**应用到:** TeamRouter 基本复制 SessionRouter 的 `pendingRpcs` / `handleRpcResponse` / `sendRpc`。routing 以 `machineId + userId` 为主，不通过 session ownership；list 无 machine 时 fan-out `getClisForUser(userId)` 后合并。

---

### `apps/gateway/src/routes/agent-teams.ts`（route, request-response）

**Analog:** `apps/gateway/src/routes/sessions.ts`

**Route setup / auth pattern**（lines 83-90）:
```typescript
export function setupSessionRoutes(
	router: Router,
	cliRegistry: CliRegistry,
	sessionRouter: SessionRouter,
) {
	// Require authentication on all session routes
	router.use(requireAuth);
```

**POST validation + service call + error pattern**（lines 118-207）:
```typescript
router.post("/session", async (request: AuthenticatedRequest, response) => {
	const userId = getUserId(request);
	if (!userId) {
		respondError(response, buildAuthorizationError(), 401);
		return;
	}
	try {
		const { cwd, title, backendId, machineId, worktree } = request.body ?? {};

		if (typeof backendId !== "string" || backendId.trim().length === 0) {
			respondError(
				response,
				buildRequestValidationError("backendId required"),
				400,
			);
			return;
		}

		logger.info({ userId, backendId, machineId }, "session_create_request");

		const session = await sessionRouter.createSession(
			{
				cwd:
					typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined,
				title:
					typeof title === "string" && title.trim().length > 0
						? title.trim()
						: undefined,
				backendId,
				machineId:
					typeof machineId === "string" && machineId.trim().length > 0
						? machineId.trim()
						: undefined,
				worktree: worktreeOptions,
			},
			userId,
		);
		response.json(session);
	} catch (error) {
		const message = getErrorMessage(error);
		logger.error({ err: error, userId }, "session_create_error");
		if (
			message.includes("No CLI connected") ||
			message.includes("Machine not found")
		) {
			respondError(response, buildAuthorizationError(message), 403);
		} else {
			respondError(response, createInternalError("service"));
		}
	}
});
```

**应用到:** `POST /acp/agent-teams`、`GET /acp/agent-teams`、`GET /acp/agent-teams/:agentTeamId` 都先 `requireAuth` + `getUserId`。请求体只接受 metadata 字段；明文字段直接 `REQUEST_VALIDATION_FAILED`。

---

### `apps/gateway/src/socket/cli-handlers.ts`（service, event-driven）

**Analog:** `apps/gateway/src/socket/cli-handlers.ts`

**CLI event relay pattern**（lines 227-239, 435-446）:
```typescript
socket.on("sessions:changed", (payload: SessionsChangedPayload) => {
	logger.info(
		{
			socketId: socket.id,
			added: payload.added.length,
			updated: payload.updated.length,
			removed: payload.removed.length,
		},
		"cli_sessions_changed",
	);
	cliRegistry.updateSessionsIncremental(socket.id, payload);
});

socket.on("rpc:response", (response: RpcResponse<unknown>) => {
	logger.debug(
		{
			requestId: response.requestId,
			isError: Boolean(response.error),
			code: response.error?.code,
		},
		"rpc_response_received",
	);
	sessionRouter.handleRpcResponse(response);
});
```

**WebUI relay with user scoping pattern**（lines 281-293, 323-327, 418-424）:
```typescript
emitToWebui(
	"sessions:changed",
	{
		added,
		updated: [],
		removed: [],
		backendCapabilities: payload.backendId
			? { [payload.backendId]: capabilities }
			: undefined,
	},
	cliRecord.userId,
);

emitToWebui(
	"session:attached",
	{ ...payload, machineId: record.machineId },
	record.userId,
);
```

**应用到:** 新增 `agent-teams:changed` handler，先查 `cliRegistry.getCliBySocketId(socket.id)`；只 `emitToWebui("agent-teams:changed", payloadWithMachineId, record.userId)`；日志只含 team count/IDs/status。

---

### `apps/webui/src/lib/api.ts`（service, request-response）

**Analog:** `apps/webui/src/lib/api.ts`

**Shared type re-export / API error pattern**（lines 1-20, 63-70, 72-118）:
```typescript
export type {
	AcpBackendSummary,
	AcpBackendsResponse,
	CreateSessionResponse,
	ErrorDetail,
	SessionSummary,
	SessionsResponse,
} from "@mobvibe/shared";
export { isErrorDetail } from "@mobvibe/shared";

export class ApiError extends Error {
	readonly detail: ErrorDetail;

	constructor(detail: ErrorDetail) {
		super(detail.message);
		this.detail = detail;
	}
}

const requestJson = async <ResponseType>(
	path: string,
	options?: RequestInit,
): Promise<ResponseType> => {
	// auth headers + platformFetch
	if (!response.ok) {
		const payload = (await response.json()) as { error?: unknown };
		if (payload?.error && isErrorDetail(payload.error)) {
			throw new ApiError(payload.error);
		}
	}
	return (await response.json()) as ResponseType;
};
```

**Endpoint function pattern**（lines 155-163, 293-308）:
```typescript
export const fetchSessions = async (): Promise<SessionsResponse> =>
	requestJson<SessionsResponse>("/acp/sessions");

export const fetchMachines = async (): Promise<MachinesResponse> =>
	requestJson<MachinesResponse>("/api/machines");

export const createSession = async (payload?: {
	cwd?: string;
	title?: string;
	backendId?: string;
	machineId?: string;
	worktree?: {
		branch?: string;
		baseBranch?: string;
		sourceCwd: string;
		relativeCwd?: string;
	};
}): Promise<CreateSessionResponse> =>
	requestJson<CreateSessionResponse>("/acp/session", {
		method: "POST",
		body: JSON.stringify(payload ?? {}),
	});
```

**应用到:** 新增 `fetchAgentTeams`、`fetchAgentTeam`、`createAgentTeam`，使用 shared 返回类型；不要在 API client 接受或发送 mailbox/task 正文。

---

### `apps/webui/src/lib/team-store.ts`（store, event-driven / transform）

**Analog:** `apps/webui/src/lib/chat-store.ts`

**Zustand persist pattern**（lines 18-23, 771-781, 1680-1710）:
```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getStorageAdapter } from "./storage-adapter";

export const useChatStore = create<ChatState>()(
	persist(
		(set) => ({
			sessions: {},
			activeSessionId: undefined,
			appError: undefined,
			setActiveSessionId: (value?: string) => set({ activeSessionId: value }),
			setAppError: (value?: ErrorDetail) => set({ appError: value }),
		}),
		{
			name: STORAGE_KEY,
			version: 1,
			partialize: partializeChatState,
			storage: {
				getItem: (name) => {
					const value = getStorageAdapter().getItem(name);
					if (!value) return null;
					try {
						return JSON.parse(value);
					} catch {
						getStorageAdapter().removeItem(name);
						return null;
					}
				},
				setItem: (name, value) => {
					getStorageAdapter().setItem(name, JSON.stringify(value));
				},
				removeItem: (name) => {
					getStorageAdapter().removeItem(name);
				},
			},
		},
	),
);
```

**Merge changed payload pattern**（lines 894-952）:
```typescript
handleSessionsChanged: (payload: SessionsChangedPayload) =>
	set((state: ChatState) => {
		const nextSessions: Record<string, ChatSession> = {
			...state.sessions,
		};

		for (const removedId of payload.removed) {
			delete nextSessions[removedId];
		}

		for (const added of payload.added) {
			const existing = nextSessions[added.sessionId];
			if (existing) {
				nextSessions[added.sessionId] = mergeSessionFromSummary(existing, added);
			} else {
				nextSessions[added.sessionId] = mergeSessionFromSummary(
					createSessionState(added.sessionId, { title: added.title }),
					added,
				);
			}
		}

		for (const updated of payload.updated) {
			const existing = nextSessions[updated.sessionId];
			if (existing) {
				nextSessions[updated.sessionId] = mergeSessionFromSummary(existing, updated);
			}
		}

		return {
			sessions: nextSessions,
			lastSyncAt: new Date().toISOString(),
		};
	}),
```

**应用到:** `team-store.ts` 可用 `teams: Record<string, AgentTeamSummary>`、`activeAgentTeamId`、`handleAgentTeamsChanged`。`partialize` 只能持久化 projection/source refs；不要保存 member transcript 或 mailbox/task body。

---

### `apps/webui/src/lib/socket.ts`（service, event-driven）

**Analog:** `apps/webui/src/lib/socket.ts`

**Typed socket + handler pattern**（lines 1-18, 121-158）:
```typescript
import { io, type Socket } from "socket.io-client";
import type {
	CliStatusPayload,
	GatewayToWebuiEvents,
	PermissionDecisionPayload,
	PermissionRequestPayload,
	SessionAttachedPayload,
	SessionDetachedPayload,
	SessionEvent,
	SessionsChangedPayload,
	WebuiToGatewayEvents,
} from "./acp";

type TypedSocket = Socket<GatewayToWebuiEvents, WebuiToGatewayEvents>;

private registerHandler<E extends keyof GatewayToWebuiEvents>(
	event: E,
	handler: GatewayToWebuiEvents[E],
): () => void {
	this.socket?.on(event, handler as never);
	return () => {
		this.socket?.off(event, handler as never);
	};
}

onSessionsChanged(handler: (payload: SessionsChangedPayload) => void) {
	return this.registerHandler("sessions:changed", handler);
}
```

**应用到:** 在 shared/webui ACP type 中加入 `AgentTeamsChangedPayload` 后，新增 `onAgentTeamsChanged(handler)`，复用 `registerHandler`。

---

## Shared Patterns

### 认证与 user/machine ownership

**Source:** `apps/gateway/src/routes/sessions.ts` lines 83-90, 96-104；`apps/gateway/src/services/session-router.ts` lines 89-101；`apps/gateway/src/services/cli-registry.ts` lines 305-314。
**Apply to:** `apps/gateway/src/routes/agent-teams.ts`, `apps/gateway/src/services/team-router.ts`

```typescript
router.use(requireAuth);

const userId = getUserId(request);
if (!userId) {
	respondError(response, buildAuthorizationError(), 401);
	return;
}

private resolveMachineForUser(machineId: string, userId: string): CliRecord {
	const cli = this.cliRegistry.getCliByMachineIdForUser(machineId, userId);
	if (!cli) {
		throw new Error("Machine not found");
	}
	return cli;
}
```

### ErrorDetail 与 HTTP 错误响应

**Source:** `apps/gateway/src/routes/sessions.ts` lines 28-50；`packages/shared/src/types/errors.ts` lines 29-52。  
**Apply to:** Gateway routes、TeamRouter、CLI RPC handlers。

```typescript
const respondError = (
	response: { status: (code: number) => { json: (body: unknown) => void } },
	detail: ErrorDetail,
	status = 500,
) => {
	response.status(status).json({ error: detail });
};

const buildRequestValidationError = (message = "Invalid request") =>
	createErrorDetail({
		code: "REQUEST_VALIDATION_FAILED",
		message,
		retryable: false,
		scope: "request",
	});
```

### Socket RPC request/response

**Source:** `packages/shared/src/types/socket-events.ts` lines 122-133；`apps/gateway/src/services/session-router.ts` lines 103-131, 1111-1155。  
**Apply to:** shared socket types、CLI daemon RPC handlers、Gateway TeamRouter。

```typescript
export type RpcRequest<TParams> = {
	requestId: string;
	params: TParams;
};

export type RpcResponse<TResult> = {
	requestId: string;
	result?: TResult;
	error?: ErrorDetail;
};

handleRpcResponse(response: RpcResponse<unknown>) {
	const pending = this.pendingRpcs.get(response.requestId);
	if (!pending) {
		return;
	}
	this.pendingRpcs.delete(response.requestId);
	clearTimeout(pending.timeout);
	if (response.error) {
		pending.reject(new Error(response.error.message));
	} else {
		pending.resolve(response.result);
	}
}
```

### SQLite current-state store

**Source:** `apps/mobvibe-cli/src/wal/migrations.ts` lines 125-149；`apps/mobvibe-cli/src/wal/wal-store.ts` lines 102-111, 193-210, 651-690。  
**Apply to:** `agent-team-store.ts`, migrations, projection builder。

```typescript
this.db = new Database(dbPath);
runMigrations(this.db);

this.stmtUpsertDiscoveredSession = this.db.query(`
  INSERT INTO discovered_sessions (...)
  VALUES (...)
  ON CONFLICT (session_id) DO UPDATE SET
    backend_id = $backendId,
    cwd = COALESCE($cwd, discovered_sessions.cwd)
`);

private rowToDiscoveredSession(row: DiscoveredSessionRow): DiscoveredSession {
	return {
		sessionId: row.session_id,
		backendId: row.backend_id,
		cwd: row.cwd ?? undefined,
		isStale: row.is_stale === 1,
	};
}
```

### Gateway/WebUI content boundary

**Source:** `.planning/phases/01-protocol-state-model-persistence-boundary/01-CONTEXT.md` lines 88-105；`apps/gateway/src/routes/sessions.ts` lines 459-489。  
**Apply to:** `agent-team.ts` projection types、Gateway routes、CLI projection builder、WebUI team store。

```typescript
if (typeof sessionId !== "string" || !isEncryptedPayload(prompt)) {
	respondError(
		response,
		buildRequestValidationError("sessionId and prompt required"),
		400,
	);
	return;
}

logger.info(
	{
		sessionId,
		userId,
		promptBlocks: "encrypted",
		requestId,
	},
	"message_send_request",
);
```

Planner 应额外要求 forbidden keys 检查：`prompt`, `content`, `body`, `description`, `summaryText`, `agentOutput` 不得进入 Gateway-facing Agent Team projection，除非是明确 `EncryptedPayload`。

### WebUI API/store projection-only merge

**Source:** `apps/webui/src/lib/api.ts` lines 72-118, 293-308；`apps/webui/src/lib/chat-store.ts` lines 894-952。  
**Apply to:** WebUI `api.ts`, `team-store.ts`, `socket.ts`。

```typescript
export const createSession = async (payload?: {
	cwd?: string;
	title?: string;
	backendId?: string;
	machineId?: string;
}): Promise<CreateSessionResponse> =>
	requestJson<CreateSessionResponse>("/acp/session", {
		method: "POST",
		body: JSON.stringify(payload ?? {}),
	});

handleSessionsChanged: (payload: SessionsChangedPayload) =>
	set((state: ChatState) => {
		const nextSessions: Record<string, ChatSession> = { ...state.sessions };
		for (const removedId of payload.removed) {
			delete nextSessions[removedId];
		}
		return { sessions: nextSessions, lastSyncAt: new Date().toISOString() };
	}),
```

## No Analog Found

本阶段所有目标文件均有可复用 analog。没有完全相同业务语义的 `AgentTeamStore` / `ProjectionBuilder`，但现有 WAL store、session router、chat store 提供了足够的结构模式。

| File | Role | Data Flow | Reason |
|---|---|---|---|
| 无 | - | - | - |

## Metadata

**Analog search scope:** `packages/shared/src/types`, `packages/shared/src/index.ts`, `apps/mobvibe-cli/src/wal`, `apps/mobvibe-cli/src/daemon`, `apps/gateway/src/routes`, `apps/gateway/src/services`, `apps/gateway/src/socket`, `apps/webui/src/lib`  
**Files scanned:** 18  
**Pattern extraction date:** 2026-05-13  
**Project skills:** 未发现项目本地 `.claude/skills/` 或 `.agents/skills/` 目录。  
**Read-only note:** 未编辑源代码；仅创建本 pattern artifact。
