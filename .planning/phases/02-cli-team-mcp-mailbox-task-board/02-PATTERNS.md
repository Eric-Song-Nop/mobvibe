# Phase 02: CLI Team MCP、Mailbox 与 Task Board - Pattern Map

**Mapped:** 2026-05-13  
**Files analyzed:** 16  
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/shared/src/types/session.ts` | model | request-response | `packages/shared/src/types/session.ts` | exact-modify |
| `packages/shared/src/types/agent-team.ts` | model | CRUD / projection | `packages/shared/src/types/agent-team.ts` | exact-modify |
| `apps/mobvibe-cli/src/acp/acp-connection.ts` | service | request-response / streaming | `apps/mobvibe-cli/src/acp/acp-connection.ts` | exact-modify |
| `apps/mobvibe-cli/src/acp/session-manager.ts` | service | request-response / event-driven | `apps/mobvibe-cli/src/acp/session-manager.ts` | exact-modify |
| `apps/mobvibe-cli/src/team/team-runtime.ts` | service | event-driven | `../AionUi/src/process/team/TeamSession.ts` + `apps/mobvibe-cli/src/team/agent-team-store.ts` | role-match |
| `apps/mobvibe-cli/src/team/team-mcp-router.ts` | service | request-response / streaming | `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts` | partial |
| `apps/mobvibe-cli/src/team/team-tool-handlers.ts` | service | request-response / CRUD | `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts` | role-match |
| `apps/mobvibe-cli/src/team/mailbox-service.ts` | service | CRUD / event-driven | `../AionUi/src/process/team/Mailbox.ts` + `apps/mobvibe-cli/src/team/agent-team-store.ts` | role-match |
| `apps/mobvibe-cli/src/team/task-board-service.ts` | service | CRUD | `../AionUi/src/process/team/TaskManager.ts` | role-match |
| `apps/mobvibe-cli/src/team/team-capability.ts` | utility | transform / validation | `apps/mobvibe-cli/src/acp/acp-connection.ts` | role-match |
| `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` | service | streaming / request-response | `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts` | partial |
| `apps/mobvibe-cli/src/team/agent-team-store.ts` | service / repository | CRUD | `apps/mobvibe-cli/src/team/agent-team-store.ts` | exact-modify |
| `apps/mobvibe-cli/src/wal/migrations.ts` | migration / config | batch / CRUD | `apps/mobvibe-cli/src/wal/migrations.ts` | exact-modify |
| `apps/mobvibe-cli/src/team/projection-builder.ts` | utility | transform | `apps/mobvibe-cli/src/team/projection-builder.ts` | exact-modify |
| `apps/mobvibe-cli/src/daemon/socket-client.ts` | service / controller | request-response / event-driven | `apps/mobvibe-cli/src/daemon/socket-client.ts` | exact-modify |
| `apps/mobvibe-cli/src/**/__tests__/*.test.ts` | test | request-response / CRUD / event-driven | existing Bun tests under `src/**/__tests__/` | exact |

## Pattern Assignments

### `packages/shared/src/types/session.ts` (model, request-response)

**Analog:** `packages/shared/src/types/session.ts`

**Imports and type-only pattern** (lines 1-2):

```typescript
import type { AvailableCommand } from "./acp.js";
import type { ErrorDetail } from "./errors.js";
```

**MCP capability extension point** (lines 122-140):

```typescript
export type AgentPromptCapabilities = {
	image?: boolean;
	audio?: boolean;
	embeddedContext?: boolean;
};

export type AgentMcpCapabilities = {
	acp?: boolean;
	stdio?: boolean;
	perSessionBridge?: boolean;
};

export type AgentSessionCapabilities = {
	list: boolean;
	load: boolean;
	prompt?: AgentPromptCapabilities;
	mcp?: AgentMcpCapabilities;
};
```

**Apply:** extend this shape rather than inventing CLI-only capability DTOs. Keep `mcp.acp` and fallback bridge capability explicit.

---

### `packages/shared/src/types/agent-team.ts` (model, CRUD / projection)

**Analog:** `packages/shared/src/types/agent-team.ts`

**Status vocabulary to preserve** (lines 28-56):

```typescript
export type TeamMcpPhase =
	| "not_started"
	| "server_starting"
	| "server_ready"
	| "session_injecting"
	| "tools_waiting"
	| "tools_ready"
	| "degraded"
	| "error";

export type TeamMcpTransport = "acp" | "stdio_bridge" | "http_bridge";

export type TeamMailboxWakeStatus =
	| "not_needed"
	| "pending"
	| "sent"
	| "failed";

export type TeamTaskStatus =
	| "todo"
	| "in_progress"
	| "blocked"
	| "completed"
	| "failed"
	| "cancelled";
```

**Projection-safe source refs** (lines 83-111):

```typescript
export type TeamSourceRef =
	| {
			type: "session_event";
			agentTeamId: AgentTeamId;
			memberId: TeamMemberId;
			sessionId: string;
			revision: number;
			seq: number;
	  }
	| {
			type: "mailbox_message";
			agentTeamId: AgentTeamId;
			messageId: TeamMailboxMessageId;
			fromMemberId: TeamMemberId;
			toMemberId?: TeamMemberId;
			deliveredSessionId?: string;
	  }
	| {
			type: "task";
			agentTeamId: AgentTeamId;
			taskId: TeamTaskId;
			ownerMemberId?: TeamMemberId;
	  };
```

**Do not copy from AionUI:** AionUI task status `pending` / `deleted` is incompatible; Mobvibe tools must use `todo/in_progress/blocked/completed/failed/cancelled`.

---

### `apps/mobvibe-cli/src/acp/acp-connection.ts` (service, request-response / streaming)

**Analog:** `apps/mobvibe-cli/src/acp/acp-connection.ts`

**Imports pattern** (lines 4-47):

```typescript
import {
	type AgentCapabilities,
	type Client,
	ClientSideConnection,
	type ContentBlock,
	type NewSessionResponse,
	ndJsonStream,
	PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import {
	type AgentSessionCapabilities,
	createErrorDetail,
	type ErrorDetail,
} from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
```

**Capability mapping pattern** (lines 286-300):

```typescript
getSessionCapabilities(): AgentSessionCapabilities {
	return {
		list: this.agentCapabilities?.sessionCapabilities?.list != null,
		load: this.agentCapabilities?.loadSession === true,
		prompt: {
			image: this.agentCapabilities?.promptCapabilities?.image === true,
			audio: this.agentCapabilities?.promptCapabilities?.audio === true,
			embeddedContext:
				this.agentCapabilities?.promptCapabilities?.embeddedContext === true,
		},
	};
}
```

**Ordinary session injection must remain empty** (lines 345-357, 813-820):

```typescript
const response = await connection.loadSession({
	sessionId,
	cwd,
	mcpServers: [],
});

const session = await connection.newSession({
	cwd,
	mcpServers: [],
});
```

**Logging/error pattern** (lines 592-607):

```typescript
} catch (error) {
	const stderrTail = this.getStderrTail();
	logger.error(
		{
			backendId: this.options.backend.id,
			command: this.options.backend.command,
			args: this.options.backend.args,
			err: error,
			stderrTail,
		},
		"acp_backend_connect_failed",
	);
	this.updateStatus("error", buildConnectError(error, stderrTail));
	await this.stopProcess();
	throw error;
}
```

**Apply:** add a team-only option path for `mcpServers`; do not mutate ordinary `createSession()` / `loadSession()` semantics. Put any RFD-only casts behind a narrow local adapter, not scattered across this file.

---

### `apps/mobvibe-cli/src/acp/session-manager.ts` (service, request-response / event-driven)

**Analog:** `apps/mobvibe-cli/src/acp/session-manager.ts`

**Validation error pattern** (lines 94-126, 202-211):

```typescript
const normalizeRelativeWorktreePath = (value: string): string => {
	const trimmed = value.trim();
	if (!trimmed || isAbsolutePathInput(trimmed)) {
		throw new AppError(
			createErrorDetail({
				code: "REQUEST_VALIDATION_FAILED",
				message: "worktree relative path must be a relative subdirectory",
				retryable: false,
				scope: "request",
			}),
			400,
		);
	}
};

const createCapabilityNotSupportedError = (message: string) =>
	new AppError(
		createErrorDetail({
			code: "CAPABILITY_NOT_SUPPORTED",
			message,
			retryable: false,
			scope: "session",
		}),
		409,
	);
```

**Session creation integration pattern** (lines 848-954):

```typescript
const connection = await this.acquireConnection(backend);
try {
	const session = await connection.createSession({ cwd: effectiveCwd });
	connection.setPermissionHandler((params) =>
		this.handlePermissionRequest(session.sessionId, params),
	);
	const now = new Date();
	const agentInfo = connection.getAgentInfo();

	const { revision } = this.walStore.ensureSession({
		sessionId: session.sessionId,
		machineId: this.config.machineId,
		backendId: backend.id,
		cwd: effectiveCwd,
		title: sessionTitle,
		isTitlePinned: hasExplicitTitle,
	});

	this.sessions.set(session.sessionId, record);
	const summary = this.buildSummary(record);
	this.emitSessionsChanged({ added: [summary], updated: [], removed: [] });
	this.emitSessionAttached(session.sessionId);
	return summary;
} catch (error) {
	await connection.disconnect();
	throw error;
}
```

**WAL event emission pattern for wake/audit work** (lines 606-651):

```typescript
private writeAndEmitEvent(
	sessionId: string,
	revision: number,
	kind: SessionEventKind,
	payload: unknown,
): SessionEvent {
	const walEvent = this.walStore.appendEvent({ sessionId, revision, kind, payload });
	const event: SessionEvent = {
		sessionId: walEvent.sessionId,
		machineId: this.config.machineId,
		revision: walEvent.revision,
		seq: walEvent.seq,
		kind: walEvent.kind,
		createdAt: walEvent.createdAt,
		payload: walEvent.payload,
	};
	this.sessionEventEmitter.emit("event", event);
	return event;
}
```

**Apply:** team wake injection should use existing active session records, `connection.prompt()`, and WAL/session event semantics; ordinary ACP permission handler stays intact.

---

### `apps/mobvibe-cli/src/team/team-runtime.ts` (service, event-driven)

**Mobvibe analog:** `apps/mobvibe-cli/src/team/agent-team-store.ts`  
**AionUI reference:** `../AionUi/src/process/team/TeamSession.ts`

**Composition pattern from AionUI** (lines 21-67):

```typescript
export class TeamSession extends EventEmitter {
  readonly teamId: string;
  private readonly mailbox: Mailbox;
  private readonly taskManager: TaskManager;
  private readonly teammateManager: TeammateManager;
  private readonly mcpServer: TeamMcpServer;

  constructor(team: TTeam, repo: ITeamRepository, workerTaskManager: IWorkerTaskManager, spawnAgent?: SpawnAgentFn) {
    super();
    this.mailbox = new Mailbox(repo);
    this.taskManager = new TaskManager(repo);
    this.teammateManager = new TeammateManager({
      teamId: team.id,
      agents: team.agents,
      mailbox: this.mailbox,
      workerTaskManager,
    });
    this.mcpServer = new TeamMcpServer({
      teamId: team.id,
      getAgents: () => this.teammateManager.getAgents(),
      mailbox: this.mailbox,
      taskManager: this.taskManager,
      wakeAgent: (slotId: string) => this.teammateManager.wake(slotId),
    });
  }
}
```

**Mobvibe store ownership pattern** (lines 39-47):

```typescript
constructor(dbPath: string) {
	const dir = path.dirname(dbPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	this.db = new Database(dbPath);
	runMigrations(this.db);
}
```

**Do not copy from AionUI:** do not make runtime own a separate repository/database; Mobvibe runtime should compose services around `AgentTeamStore` and existing `SessionManager`.

---

### `apps/mobvibe-cli/src/team/team-mcp-router.ts` (service, request-response / streaming)

**AionUI analog:** `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts`  
**Match note:** AionUI is TCP+stdio; Mobvibe primary must be MCP-over-ACP. Copy dispatch/binding ideas only.

**Caller binding reference** (lines 152-188):

```typescript
private handleTcpConnection(socket: net.Socket): void {
  const reader = createTcpMessageReader(async (msg) => {
    const request = msg as {
      tool?: string;
      type?: string;
      args?: Record<string, unknown>;
      from_slot_id?: string;
      slot_id?: string;
      auth_token?: string;
    };

    if (request.auth_token !== this.authToken) {
      writeTcpMessage(socket, { error: 'Unauthorized' });
      socket.end();
      return;
    }

    const toolName = request.tool ?? '';
    const args = request.args ?? {};
    const fromSlotId = request.from_slot_id;
    const result = await this.handleToolCall(toolName, args, fromSlotId);
    writeTcpMessage(socket, { result });
  });
}
```

**Readiness notification reference** (lines 170-179):

```typescript
if (request.type === 'mcp_ready' && !request.tool) {
  const readySlotId = request.from_slot_id ?? request.slot_id;
  if (readySlotId) {
    notifyMcpReady(readySlotId);
  }
  writeTcpMessage(socket, { result: 'ok' });
  socket.end();
  return;
}
```

**Mobvibe adaptation:** bind caller by ACP server id / connection id, not by `from_slot_id` in tool args. Mark `tools_ready` only after list-tools confirms all expected `mobvibe_team_*` tools.

---

### `apps/mobvibe-cli/src/team/team-tool-handlers.ts` (service, request-response / CRUD)

**AionUI analog:** `../AionUi/src/process/team/mcp/team/TeamMcpServer.ts`

**Dispatch pattern** (lines 204-233):

```typescript
private async handleToolCall(toolName: string, args: Record<string, unknown>, fromSlotId?: string): Promise<string> {
  switch (toolName) {
    case 'team_send_message':
      return this.handleSendMessage(args, fromSlotId);
    case 'team_task_create':
      return this.handleTaskCreate(args);
    case 'team_task_update':
      return this.handleTaskUpdate(args);
    case 'team_task_list':
      return this.handleTaskList();
    case 'team_members':
      return this.handleTeamMembers();
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

**Broadcast addressing pattern** (lines 251-272):

```typescript
if (to === '*') {
  const recipients: string[] = [];
  await Promise.all(
    agents
      .filter((agent) => agent.slotId !== fromSlotId)
      .map((agent) =>
        mailbox.write({
          teamId,
          toAgentId: agent.slotId,
          fromAgentId: fromSlotId,
          content: message,
          summary,
        }).then(() => {
          recipients.push(agent.agentName);
          void wakeAgent(agent.slotId);
        })
      )
  );
  return `Message broadcast to ${recipients.length} teammate(s): ${recipients.join(', ')}`;
}
```

**Members formatting pattern** (lines 410-417):

```typescript
private async handleTeamMembers(): Promise<string> {
  const agents = this.params.getAgents();
  if (agents.length === 0) {
    return 'No team members yet.';
  }
  const lines = agents.map((a) => `- ${a.agentName} (type: ${a.agentType}, role: ${a.role}, status: ${a.status})`);
  return `## Team Members\n${lines.join('\n')}`;
}
```

**Do not copy:** AionUI leader-only gate on `team_spawn_agent` lines 208-216 and `pending/deleted` validation lines 382-388. Mobvibe Phase 2 has no leader-only team tools and must use `mobvibe_team_*` names.

---

### `apps/mobvibe-cli/src/team/mailbox-service.ts` (service, CRUD / event-driven)

**Mobvibe analog:** `apps/mobvibe-cli/src/team/agent-team-store.ts`  
**AionUI reference:** `../AionUi/src/process/team/Mailbox.ts`, `../AionUi/src/process/team/TeamSession.ts`, `../AionUi/src/process/team/TeammateManager.ts`

**Thin service API pattern** (AionUI `Mailbox.ts` lines 5-44):

```typescript
export class Mailbox {
  constructor(private readonly repo: ITeamRepository) {}

  async write(params: {
    teamId: string;
    toAgentId: string;
    fromAgentId: string;
    content: string;
    type?: MailboxMessage['type'];
    summary?: string;
    files?: string[];
  }): Promise<MailboxMessage> {
    const message: MailboxMessage = {
      id: crypto.randomUUID(),
      teamId: params.teamId,
      toAgentId: params.toAgentId,
      fromAgentId: params.fromAgentId,
      type: params.type ?? 'message',
      content: params.content,
      read: false,
      createdAt: Date.now(),
    };
    return this.repo.writeMessage(message);
  }

  async readUnread(teamId: string, agentId: string): Promise<MailboxMessage[]> {
    return this.repo.readUnreadAndMark(teamId, agentId);
  }
}
```

**Durable-first wake pattern** (AionUI `TeamSession.ts` lines 89-100):

```typescript
private async wakeAfterAcceptedDelivery(slotId: string, context: 'team' | 'agent'): Promise<void> {
  try {
    await this.teammateManager.wake(slotId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TeamSession] Accepted ${context} message but failed to wake ${slotId}:`, message);
  }
}
```

**Atomic read-and-mark reference** (AionUI `SqliteTeamRepository.ts` lines 230-245):

```typescript
async readUnreadAndMark(teamId: string, toAgentId: string): Promise<MailboxMessage[]> {
  const db = await this.getDb();
  const rows = db.transaction(() => {
    const unread = db.prepare(
      `SELECT * FROM mailbox WHERE team_id = ? AND to_agent_id = ? AND read = 0
       ORDER BY created_at ASC`
    ).all(teamId, toAgentId) as MailboxRow[];
    if (unread.length > 0) {
      const ids = unread.map((r) => r.id);
      db.prepare(`UPDATE mailbox SET read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }
    return unread;
  })();
  return rows.map(rowToMailbox);
}
```

**Mobvibe persistence table** (`migrations.ts` lines 169-180):

```sql
CREATE TABLE IF NOT EXISTS agent_team_mailbox_messages (
  message_id TEXT PRIMARY KEY,
  agent_team_id TEXT NOT NULL,
  from_member_id TEXT NOT NULL,
  to_member_id TEXT,
  body_local_json TEXT NOT NULL,
  source_refs_json TEXT,
  read_at TEXT,
  wake_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**Apply:** `send_message` success means row committed. Wake status (`pending/sent/failed`) is updated separately and must not roll back delivery.

---

### `apps/mobvibe-cli/src/team/task-board-service.ts` (service, CRUD)

**AionUI analog:** `../AionUi/src/process/team/TaskManager.ts`  
**Mobvibe status source:** `packages/shared/src/types/agent-team.ts`

**Create + dependency append pattern** (AionUI lines 33-56):

```typescript
async create(params: CreateTaskParams): Promise<TeamTask> {
  const now = Date.now();
  const task: TeamTask = {
    id: crypto.randomUUID(),
    teamId: params.teamId,
    subject: params.subject,
    description: params.description,
    status: 'pending',
    owner: params.owner,
    blockedBy: params.blockedBy ?? [],
    blocks: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  const created = await this.repo.createTask(task);

  if (created.blockedBy.length > 0) {
    await Promise.all(created.blockedBy.map((upstreamId) => this.repo.appendToBlocks(upstreamId, created.id)));
  }

  return created;
}
```

**Unblock pattern** (AionUI lines 89-105):

```typescript
async checkUnblocks(taskId: string): Promise<TeamTask[]> {
  const completedTask = await this.repo.findTaskById(taskId);
  if (!completedTask) return [];

  const allTasks = await this.repo.findTasksByTeam(completedTask.teamId);
  const dependents = allTasks.filter((t) => t.blockedBy.includes(taskId));

  if (dependents.length === 0) return [];

  const updated = await Promise.all(dependents.map((t) => this.repo.removeFromBlockedBy(t.id, taskId)));
  await this.repo.updateTask(taskId, { blocks: [], updatedAt: Date.now() });

  return updated.filter((t) => t.blockedBy.length === 0);
}
```

**Mobvibe task table** (`migrations.ts` lines 182-194):

```sql
CREATE TABLE IF NOT EXISTS agent_team_tasks (
  task_id TEXT PRIMARY KEY,
  agent_team_id TEXT NOT NULL,
  owner_member_id TEXT,
  status TEXT NOT NULL,
  body_local_json TEXT NOT NULL,
  blocked_by_json TEXT,
  blocks_json TEXT,
  source_refs_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Apply:** adapt AionUI dependency graph exactly, but use Mobvibe `todo` as default when unblocked and `blocked` when `blockedBy.length > 0`.

---

### `apps/mobvibe-cli/src/team/team-capability.ts` (utility, transform / validation)

**Analog:** `apps/mobvibe-cli/src/acp/acp-connection.ts` + `apps/mobvibe-cli/src/acp/session-manager.ts`

**Capability getter to extend** (`acp-connection.ts` lines 286-300):

```typescript
getSessionCapabilities(): AgentSessionCapabilities {
	return {
		list: this.agentCapabilities?.sessionCapabilities?.list != null,
		load: this.agentCapabilities?.loadSession === true,
		prompt: {
			image: this.agentCapabilities?.promptCapabilities?.image === true,
			audio: this.agentCapabilities?.promptCapabilities?.audio === true,
			embeddedContext:
				this.agentCapabilities?.promptCapabilities?.embeddedContext === true,
		},
	};
}
```

**Capability rejection pattern** (`session-manager.ts` lines 202-211):

```typescript
const createCapabilityNotSupportedError = (message: string) =>
	new AppError(
		createErrorDetail({
			code: "CAPABILITY_NOT_SUPPORTED",
			message,
			retryable: false,
			scope: "session",
		}),
		409,
	);
```

**Apply:** validate native `mcp.acp` before primary path; allow `stdio_bridge` only per session. Do not write global agent config.

---

### `apps/mobvibe-cli/src/team/team-bridge-stdio.ts` (service, streaming / request-response)

**AionUI analog:** `../AionUi/src/process/team/mcp/team/teamMcpStdio.ts`  
**Match note:** fallback only. Do not copy as primary transport.

**MCP SDK registration pattern** (lines 14-18, 126-150):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'aionui-team', version: '1.0.0' }, { capabilities: { tools: {} } });

createTeamTool(
  server,
  'team_send_message',
  `Send a message to a teammate by name...`,
  {
    to: z.string().describe('Recipient teammate name, or "*" for broadcast to all'),
    message: z.string().describe('The message content to send'),
    summary: z.string().optional().describe('A short 5-10 word summary for the UI'),
  },
  TEAM_MCP_PORT,
  TEAM_AGENT_SLOT_ID,
  TEAM_MCP_TOKEN
);
```

**Tool wrapper error shape** (lines 99-120):

```typescript
server.tool(toolName, description, schema, async (args: Record<string, unknown>) => {
  try {
    const payload: Record<string, unknown> = { tool: toolName, args, auth_token: authToken };
    if (agentSlotId) payload.from_slot_id = agentSlotId;
    const response = await sendTcpRequest(tcpPort, payload);

    if (response.error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${response.error}` }],
        isError: true,
      };
    }

    return { content: [{ type: 'text' as const, text: response.result || '' }] };
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});
```

**Do not copy:** `TEAM_MCP_PORT`/TCP bridge environment as the only transport; in Mobvibe this belongs to `stdio_bridge` fallback only, never ordinary/global config.

---

### `apps/mobvibe-cli/src/team/agent-team-store.ts` (service / repository, CRUD)

**Analog:** `apps/mobvibe-cli/src/team/agent-team-store.ts`

**Prepared statement + transaction pattern** (lines 48-72, 110-154):

```typescript
this.stmtInsertTeam = this.db.query(`
  INSERT INTO agent_teams (
    agent_team_id, machine_id, workspace_root_cwd, title, lifecycle,
    leader_member_id, workspace_mode, created_at, updated_at, archived_at
  ) VALUES (
    $agentTeamId, $machineId, $workspaceRootCwd, $title, $lifecycle,
    $leaderMemberId, $workspaceMode, $createdAt, $updatedAt, $archivedAt
  )
`);

createAgentTeam(params: CreateAgentTeamRpcParams): CreateAgentTeamRpcResult {
	const now = new Date().toISOString();
	const agentTeamId = randomUUID();
	const leaderMemberId = randomUUID();

	this.db.transaction(() => {
		this.stmtInsertTeam.run({
			$agentTeamId: agentTeamId,
			$machineId: params.machineId,
			$workspaceRootCwd: params.workspaceRootCwd,
			$title: title,
			$lifecycle: "pending",
			$leaderMemberId: leaderMemberId,
			$workspaceMode: workspaceMode,
			$createdAt: now,
			$updatedAt: now,
			$archivedAt: null,
		});
	})();
}
```

**Projection guard pattern** (lines 191-213):

```typescript
private projectTeam(row: AgentTeamRow) {
	const agentTeamId = row.agent_team_id;
	const team = buildAgentTeamSummary({
		team: row,
		members: this.stmtListMembers.all({ $agentTeamId: agentTeamId }) as AgentTeamMemberRow[],
		mcpStatuses: this.stmtListMcpStatuses.all({ $agentTeamId: agentTeamId }) as AgentTeamMcpStatusRow[],
		mailboxMessages: this.stmtListMailboxMessages.all({ $agentTeamId: agentTeamId }) as AgentTeamMailboxMessageRow[],
		tasks: this.stmtListTasks.all({ $agentTeamId: agentTeamId }) as AgentTeamTaskRow[],
		summaryRefs: this.stmtListSummaryRefs.all({ $agentTeamId: agentTeamId }) as AgentTeamSummaryRefRow[],
	});
	assertGatewayFacingAgentTeamPayload(team);
	return team;
}
```

**Apply:** add store methods for mailbox/task/MCP readiness here. Keep SQL parameterized and projection-safe.

---

### `apps/mobvibe-cli/src/wal/migrations.ts` (migration / config, batch / CRUD)

**Analog:** `apps/mobvibe-cli/src/wal/migrations.ts`

**Migration array pattern** (lines 3-7, 124-215):

```typescript
const MIGRATIONS = [
	{
		version: 7,
		up: `
      CREATE TABLE IF NOT EXISTS agent_teams (...);
      CREATE TABLE IF NOT EXISTS agent_team_members (...);
      CREATE TABLE IF NOT EXISTS agent_team_mcp_status (...);
      CREATE TABLE IF NOT EXISTS agent_team_mailbox_messages (...);
      CREATE TABLE IF NOT EXISTS agent_team_tasks (...);
    `,
	},
];
```

**Runner pattern** (lines 218-242):

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
			db.exec(`INSERT INTO schema_version (version) VALUES (${migration.version})`);
		}
	}
}
```

**Apply:** if adding columns such as wake error/source refs, append version 8; do not edit historical migration semantics except with careful backward-compatible SQL.

---

### `apps/mobvibe-cli/src/team/projection-builder.ts` (utility, transform)

**Analog:** `apps/mobvibe-cli/src/team/projection-builder.ts`

**Summary assembly pattern** (lines 26-57):

```typescript
export function buildAgentTeamSummary(
	input: AgentTeamProjectionInput,
): AgentTeamSummary {
	const lifecycle = parseAgentTeamLifecycle(input.team.lifecycle);
	const members = input.members.map((row) =>
		buildMemberSummary(row, input.mcpStatuses, input.mailboxMessages, input.tasks),
	);
	const summary: AgentTeamSummary = {
		agentTeamId: input.team.agent_team_id,
		machineId: input.team.machine_id,
		title: input.team.title,
		workspaceRootCwd: input.team.workspace_root_cwd,
		leaderMemberId: input.team.leader_member_id,
		lifecycle,
		members,
		mailboxCounts: buildMailboxCounts(input.mailboxMessages),
		taskCounts: buildTaskCounts(input.tasks),
		sourceRefs: collectSourceRefs([...input.mailboxMessages, ...input.tasks]),
	};

	return withoutEmptyCollections(summary);
}
```

**Counts pattern** (lines 111-155):

```typescript
function buildMailboxCounts(rows: AgentTeamMailboxMessageRow[]): TeamMailboxCounts {
	const count = rows.reduce(
		(result, row) => ({
			unread: result.unread + (row.read_at ? 0 : 1),
			wakePending: result.wakePending + (row.wake_status === "pending" ? 1 : 0),
			wakeFailed: result.wakeFailed + (row.wake_status === "failed" ? 1 : 0),
			lastMailboxAt:
				!result.lastMailboxAt || row.created_at > result.lastMailboxAt
					? row.created_at
					: result.lastMailboxAt,
		}),
		{ unread: 0, wakePending: 0, wakeFailed: 0 } as TeamMailboxCounts,
	);
	return count.lastMailboxAt ? count : { ...count, lastMailboxAt: undefined };
}
```

**Source ref parser pattern** (lines 235-270): keep recursive validation allowlisted by `type` and required ids.

**Apply:** Gateway projection never includes `body_local_json`, task descriptions, mailbox body, prompt, summary text, or agent output.

---

### `apps/mobvibe-cli/src/team/content-boundary.ts` (utility, validation)

**Analog:** `apps/mobvibe-cli/src/team/content-boundary.ts`

**Forbidden-key guard** (lines 1-37):

```typescript
export const FORBIDDEN_GATEWAY_CONTENT_KEYS = [
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
] as const;

export function assertGatewayFacingAgentTeamPayload(value: unknown): void {
	visitGatewayPayload(value);
}

function visitGatewayPayload(value: unknown): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) visitGatewayPayload(item);
		return;
	}

	for (const [key, child] of Object.entries(value)) {
		if (forbiddenKeys.has(key)) {
			throw new Error(`Forbidden Gateway-facing Agent Team key: ${key}`);
		}
		visitGatewayPayload(child);
	}
}
```

**Apply:** run this after every modified `AgentTeamSummary` projection; add tests if new projection fields are introduced.

---

### `apps/mobvibe-cli/src/daemon/socket-client.ts` (service / controller, request-response / event-driven)

**Analog:** `apps/mobvibe-cli/src/daemon/socket-client.ts`

**AgentTeamStore wiring** (lines 50-56, 171-178):

```typescript
type SocketClientOptions = {
	config: CliConfig;
	sessionManager: SessionManager;
	cryptoService: CliCryptoService;
	agentTeamStore?: AgentTeamStore;
};

private readonly agentTeamStore: AgentTeamStore;

constructor(private readonly options: SocketClientOptions) {
	super();
	this.agentTeamStore =
		options.agentTeamStore ?? new AgentTeamStore(options.config.walDbPath);
}
```

**RPC handler + changed event pattern** (lines 323-350):

```typescript
this.socket.on("rpc:agent-team:create", async (request) => {
	try {
		logger.info(
			{ requestId: request.requestId, machineId: request.params.machineId },
			"rpc_agent_team_create",
		);
		const result = agentTeamStore.createAgentTeam(request.params);
		this.sendRpcResponse(request.requestId, result);
		this.socket.emit("agent-teams:changed", {
			added: [result.team],
			updated: [],
			removed: [],
			machineId: result.team.machineId,
		});
	} catch (error) {
		logger.error({ err: error, requestId: request.requestId }, "rpc_agent_team_create_error");
		this.sendRpcError(request.requestId, error);
	}
});
```

**Session event encryption boundary** (lines 1437-1463):

```typescript
sessionManager.onSessionEvent((event) => {
	if (this.connected) {
		const encrypted = this.options.cryptoService.encryptEvent(event);
		this.socket.emit("session:event", encrypted);
	}
});
```

**Apply:** after durable mailbox/task/MCP state changes, emit `agent-teams:changed` with projection only. Do not send local mailbox/task body over Gateway RPC/event.

---

### `apps/mobvibe-cli/src/**/__tests__/*.test.ts` (test, CRUD / event-driven)

**Mobvibe analogs:**
- `apps/mobvibe-cli/src/team/__tests__/agent-team-store.test.ts`
- `apps/mobvibe-cli/src/acp/__tests__/acp-connection.test.ts`
- `apps/mobvibe-cli/src/acp/__tests__/session-manager.test.ts`

**Bun test imports and temp SQLite pattern** (`agent-team-store.test.ts` lines 1-24):

```typescript
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("AgentTeamStore durable metadata", () => {
	let tempDir: string;
	let dbPath: string;
	let store: AgentTeamStore;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-store-"));
		dbPath = path.join(tempDir, "events.db");
		store = new AgentTeamStore(dbPath);
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
```

**Content boundary regression pattern** (`agent-team-store.test.ts` lines 115-242):

```typescript
test("projects counts, source refs, and safe status without local content", () => {
	// insert rows with body_local_json containing body/prompt/description
	const projected = store.getAgentTeam({ agentTeamId: team.agentTeamId }).team;
	const serialized = JSON.stringify(projected);

	expect(serialized).not.toContain("local mailbox body");
	expect(serialized).not.toContain("local task description");
	expect(serialized).not.toContain("local output");
	expect(serialized).not.toContain("body_local_json");
});
```

**Mocked ACP connection test style** (`session-manager.test.ts` lines 69-130):

```typescript
const createMockConnection = () => ({
	connect: mock(() => Promise.resolve(undefined)),
	disconnect: mock(() => Promise.resolve(undefined)),
	createSession: mock(() =>
		Promise.resolve({ sessionId: "new-session-1", modes: null, models: null }),
	),
	getSessionCapabilities: mock(() => ({ list: true, load: true })),
	setPermissionHandler: mock(() => {}),
	onSessionUpdate: mock((cb: (n: SessionNotification) => void) => {
		sessionUpdateCallback = cb;
		return () => { sessionUpdateCallback = undefined; };
	}),
});
```

**Apply:** new tests should live under `apps/mobvibe-cli/src/team/__tests__/` and use `bun:test`, not Vitest. AionUI tests are behavioral references only.

## Shared Patterns

### Native MCP-over-ACP adapter boundary

**Source:** `apps/mobvibe-cli/src/acp/acp-connection.ts` lines 610-820; RFD from research.  
**Apply to:** `acp-connection.ts`, `team-mcp-router.ts`, `team-runtime.ts`.

```typescript
async createSession(options?: { cwd?: string }): Promise<NewSessionResponse> {
	const connection = await this.ensureReady();
	const response = await this.createSessionInternal(
		connection,
		options?.cwd ?? process.cwd(),
	);
	this.sessionId = response.sessionId;
	return response;
}

private async createSessionInternal(
	connection: ClientSideConnection,
	cwd: string,
): Promise<NewSessionResponse> {
	const session = await connection.newSession({ cwd, mcpServers: [] });
	return session;
}
```

Planner note: add team-specific overload/options so only team member sessions receive `{ type: "acp", name: "mobvibe-team", id }`.

### Durable store then projection event

**Source:** `apps/mobvibe-cli/src/team/agent-team-store.ts` lines 117-160; `socket-client.ts` lines 332-339.  
**Apply to:** mailbox writes, task writes, MCP readiness changes.

```typescript
this.db.transaction(() => {
	// mutate durable rows
})();

const team = this.getAgentTeam({ agentTeamId }).team;
if (!team) throw new Error(`Agent Team was not updated: ${agentTeamId}`);
return { team };

this.socket.emit("agent-teams:changed", {
	added: [],
	updated: [result.team],
	removed: [],
	machineId: result.team.machineId,
});
```

### Content boundary

**Source:** `apps/mobvibe-cli/src/team/content-boundary.ts` lines 1-37 and `projection-builder.ts` lines 88-101 / 95-100.  
**Apply to:** all Gateway-facing Agent Team projections.

```typescript
this.stmtListMailboxMessages = this.db.query(`
  SELECT message_id, agent_team_id, from_member_id, to_member_id, source_refs_json,
         read_at, wake_status, created_at
  FROM agent_team_mailbox_messages
  WHERE agent_team_id = $agentTeamId
  ORDER BY created_at ASC
`);
```

Do not select `body_local_json` for projections.

### Error handling and logging

**Source:** `apps/mobvibe-cli/src/daemon/socket-client.ts` lines 1533-1561 and `acp-connection.ts` lines 592-607.  
**Apply to:** router/tool handler/service boundaries.

```typescript
private sendRpcError(requestId: string, error: unknown) {
	const message = error instanceof Error ? error.message : "Unknown error";
	logger.error({ requestId, err: error, message }, "rpc_response_error_sent");
	const response: RpcResponse<unknown> = {
		requestId,
		error: {
			code: "INTERNAL_ERROR",
			message,
			retryable: true,
			scope: "request",
		},
	};
	this.socket.emit("rpc:response", response);
}
```

Use pino `logger`, not long-lived `console.log`, in Mobvibe code.

### Wake/injection semantics

**Source:** AionUI `TeammateManager.ts` lines 94-156, 327-363; Mobvibe `SessionManager.writeAndEmitEvent` lines 606-651.  
**Apply to:** `mailbox-service.ts`, `team-runtime.ts`.

```typescript
const mailboxMessages = await this.mailbox.readUnread(this.teamId, slotId);
if (agent.conversationId && mailboxMessages.length > 0 && agent.role !== 'lead') {
  for (const msg of mailboxMessages) {
    // write incoming teammate message into target conversation for auditability
  }
}

if (agent.role !== 'lead') {
  await this.mailbox.write({
    teamId: this.teamId,
    toAgentId: leadAgent.slotId,
    fromAgentId: agent.slotId,
    content: 'Turn completed',
    type: 'idle_notification',
  });
  this.maybeWakeLeaderWhenAllIdle(leadAgent.slotId);
}
```

Mobvibe adaptation: inject via ordinary ACP `connection.prompt(sessionId, prompt)` and WAL/source refs, not AionUI renderer IPC.

### AionUI patterns that must NOT be copied

| AionUI Pattern | Source | Why not |
|---|---|---|
| TCP + stdio bridge as primary MCP transport | `TeamMcpServer.ts` lines 58-110, `teamMcpStdio.ts` lines 20-35 | Mobvibe primary is native MCP-over-ACP; bridge is per-session fallback only. |
| Caller identity from `TEAM_AGENT_SLOT_ID` / `from_slot_id` | `TeamMcpServer.ts` lines 154-160, 184 | Mobvibe caller identity must come from component-generated ACP MCP server id binding. |
| Leader-only `team_spawn_agent` gate | `TeamMcpServer.ts` lines 208-216 | Phase 2 explicitly has no leader-only `mobvibe_team_*` tools. |
| `pending` / `deleted` task statuses | `TeamMcpServer.ts` lines 382-388; `TaskManager.ts` line 40 | Mobvibe uses `todo/in_progress/blocked/completed/failed/cancelled`. |
| Renderer IPC / Electron message injection | `TeammateManager.ts` lines 148-154 | Mobvibe CLI should use ACP prompt/session WAL and Gateway-safe encrypted events. |
| AionUI UI/project conventions | `../AionUi/AGENTS.md` lines 23-35, 46-53 | Arco/UnoCSS/Electron process split does not apply to Mobvibe CLI runtime. |

## No Analog Found

No file is fully without an analog. The weakest match is `team-mcp-router.ts` because Mobvibe’s primary native MCP-over-ACP router does not exist yet; AionUI provides only a TCP/stdio partial reference.

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/mobvibe-cli/src/team/team-mcp-router.ts` | service | request-response / streaming | No native ACP `mcp/connect` / `mcp/message` router exists in Mobvibe; use RFD plus AionUI dispatch as partial reference. |

## Metadata

**Analog search scope:** `apps/mobvibe-cli/src/{team,acp,daemon,wal}`, `packages/shared/src/types`, `../AionUi/src/process/team`, `../AionUi/src/process/agent/acp`, `../AionUi/tests/unit/team-*.test.ts`  
**Files scanned:** 24  
**Pattern extraction date:** 2026-05-13
