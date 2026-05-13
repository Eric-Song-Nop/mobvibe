# Agent Team 协作技术栈建议

**项目:** Mobvibe Agent Team  
**研究维度:** Stack / libraries / protocol boundaries  
**研究日期:** 2026-05-12  
**总体结论:** v1 不引入 LangGraph/AutoGen/CrewAI 或新消息队列；在现有 TypeScript monorepo 内扩展 shared 协议、Gateway 路由、CLI local team store、CLI team MCP server、mailbox/task board、WebUI React Query/Zustand/Socket.io 模式。

## 推荐栈结论

Agent Team 的核心新增运行时应放在 **Mobvibe CLI 本地**：team MCP server、mailbox、task board、leader/member session manager 和 durable store。成员仍是普通 ACP session。Gateway 继续是 relay 和 auth boundary，不成为 agent runtime、内容处理器或 durable truth。Team tools 首选 ACP 官方 MCP-over-ACP per-session transport 注入，普通 session 不声明该 MCP server，因此普通 agent 使用不受影响。

**不建议新增大型依赖。** 当前仓库已有足够基础：TypeScript、Socket.io、React、React Query、Zustand、CLI SQLite/WAL、ACP SDK、pino、Vitest/Bun test/Playwright。v1 的风险是协议边界、MCP 注入、持久化和安全，不是缺少编排框架。

## 现有版本基线

| 类别 | 现有技术 | v1 Agent Team 用法 |
|---|---|---|
| Monorepo | pnpm + Turborepo | 沿用 workspace 包边界；先改 shared 类型再改 apps。 |
| 语言 | TypeScript | 所有 team/MCP/mailbox/task payload 显式类型；禁止 `any`。 |
| Gateway runtime | Node.js | Auth、REST、Socket.io、RPC relay；不解密内容，不执行 team tools。 |
| CLI runtime | Bun | 本地 team store、MCP server、mailbox/task board、session manager integration。 |
| HTTP API | Express | `/acp/team-runs` 表达用户 intent 和 snapshot 读取。 |
| Realtime | Socket.io | Team snapshot/readiness/task/mailbox non-content delta；成员输出仍走 `session:event`。 |
| ACP runtime | `@agentclientprotocol/sdk` | Leader/member 是普通 ACP session；team 能力优先依赖 MCP-over-ACP per-session injection，必要时使用 per-session stdio/HTTP bridge。 |
| Frontend | React + Vite | Team create/monitor/detail 用现有组件、hooks 和响应式模式。 |
| Server state | React Query | Team list/detail/create/cancel/retry/archive request/response。 |
| Client state | Zustand | Team projection、选中状态、MCP phase、task/mailbox counts；不保存 transcript。 |
| CLI persistence | SQLite WAL via `WalStore` | 推荐扩展或新增 CLI team store，持久化 team/mailbox/task/MCP readiness。 |
| Gateway DB | Drizzle/PostgreSQL | v1 不作为 team truth；未来可做非内容 metadata 投影。 |
| Logging | pino | 记录 ids/count/status/error code；redact prompt/output/mailbox/task/summary。 |
| Formatting/lint | Biome | 继续 `pnpm format && pnpm lint`。 |
| Tests | Vitest / Bun test / Playwright | shared/gateway/webui 用 Vitest；CLI team runtime 用 Bun test。 |

## 应扩展的现有包和模块

### 1. `packages/shared`：先定义 team 协议边界

建议新增或扩展 team 类型，覆盖：

- `TeamRunId`、`TeamMemberId`、`TeamTaskId`、`TeamMailboxMessageId`。
- `TeamRunStatus`、`TeamMemberStatus`、`TeamMcpPhase`、`TeamWorkspaceMode`。
- `TeamRunSummary`、`TeamRunDetail`、`TeamMemberSummary`。
- `TeamTaskSummary`、`TeamTaskCounts`、`TeamMailboxCounts`。
- `TeamToolPolicy`、`TeamCapabilityStatus`。
- `CreateTeamRunParams`、`CancelTeamRunParams`、`RetryTeamMemberParams`、`ArchiveTeamRunParams`。
- `TeamRunChangedPayload`、`TeamMcpStatusPayload`、`TeamTaskChangedPayload`、`TeamMailboxChangedPayload`。

Gateway-facing types 必须避免 plaintext content 字段。需要内容时使用 encrypted payload、local-only field 或 source refs。

### 2. `packages/shared/src/types/session.ts`：最小 team 关联

`SessionSummary` 可加可选字段：

- `teamRunId?: string`
- `teamMemberId?: string`
- `teamRole?: "leader" | "member"`
- `teamMcpPhase?: TeamMcpPhase`

这些字段只用于导航和 projection，不嵌入完整 team state。

### 3. CLI team modules：v1 核心运行时

推荐新增模块：

```text
apps/mobvibe-cli/src/team/team-store.ts
apps/mobvibe-cli/src/team/team-session-manager.ts
apps/mobvibe-cli/src/team/team-mcp-server.ts
apps/mobvibe-cli/src/team/mailbox-store.ts
apps/mobvibe-cli/src/team/task-board-store.ts
apps/mobvibe-cli/src/team/team-capabilities.ts
apps/mobvibe-cli/src/team/team-tool-policy.ts
```

职责：

- TeamStore 持久化 team run、member、MCP readiness、source refs。
- TeamMcpServer 暴露 `mobvibe_team_*` tools，生成 MCP-over-ACP server declaration 或 per-session bridge config，校验 server id/token 和 caller identity。
- MailboxStore 提供 durable write/read unread/read history/wake status。
- TaskBoardStore 提供 create/update/list、owner、status、blockedBy/blocks。
- TeamSessionManager 创建 leader/member 普通 ACP session，注入 MCP config，处理 wake/idle、cancel/retry/archive/recovery。
- TeamCapabilities 检查 backend 是否支持 native `mcpCapabilities.acp`，或是否能安全使用仅作用于 team session 的 bridge；不支持则阻止自治 teammate。

### 4. CLI MCP transport 实现

推荐最小实现：

- 每个 team 一个本地 MCP server handler。
- 优先在 team `session/new` 中声明 `transport: "acp"` 的 MCP server，并使用 CLI 生成的唯一 `id` 路由回 `teamRunId/memberId/sessionId`。
- Agent advertises `mcpCapabilities.acp` 时直接通过 ACP channel 处理 `mcp/connect`、`mcp/message`、`mcp/disconnect`。
- Agent 不支持 native ACP transport 时，只能为该 team session 使用 stdio/HTTP bridge；bridge 如需本地 server，只监听 loopback 并使用 per-team token 或等价鉴权。
- 每个 per-session declaration 或 bridge config 携带 member identity。
- MCP readiness 以 phase 形式持久化和上报。

MCP-over-ACP 是“team feature 不影响其他 agent 使用”的关键：不修改 agent 全局 MCP 配置，不给普通 session 注入 team server，不复用跨 team 的 server id。桥接脚本也必须按 session 生命周期创建和清理。

### 5. Gateway routes/router：只做 intent 和 relay

推荐新增：

```text
apps/gateway/src/routes/team-runs.ts
apps/gateway/src/services/team-router.ts
```

Gateway 负责：

- `requireAuth`。
- 验证 machine/session 属于当前 user。
- 校验 payload shape 和禁止 plaintext content。
- 将 team RPC 转发给目标 CLI。
- 转发 CLI 上报的 team snapshot/change event。

Gateway 不负责：

- 启动 MCP server。
- 保存 mailbox/task 正文。
- 解密或生成 summary。
- 从 agent output 推断任务状态。

### 6. WebUI team feature

推荐新增：

```text
apps/webui/src/hooks/use-team-runs.ts
apps/webui/src/hooks/use-team-socket.ts
apps/webui/src/lib/team-store.ts
apps/webui/src/components/team/
```

WebUI 使用 React Query 管理 snapshot/mutation，Zustand 管理 realtime projection 和 UI 展开状态。成员 transcript 仍从现有 chat/session store 按 `sessionId` 加载。

## 协议边界建议

### HTTP：用户 intent 和快照读取

```text
GET    /acp/team-runs
POST   /acp/team-runs
GET    /acp/team-runs/:teamRunId
POST   /acp/team-runs/:teamRunId/cancel
POST   /acp/team-runs/:teamRunId/archive
POST   /acp/team-runs/:teamRunId/members/:memberId/retry
```

### Socket.io：非内容实时 projection

```text
subscribe:team-run
unsubscribe:team-run
team-run:changed
team-mcp:changed
team-task:changed
team-mailbox:changed
```

成员输出、权限、文件/Git 仍走普通 session 通道。

### CLI RPC：本地 team runtime

```text
rpc:team:create
rpc:team:list
rpc:team:get
rpc:team:cancel
rpc:team:archive
rpc:team:member:retry
rpc:team:member:confirm-spawn
```

如果某些操作由 MCP tool call 触发，Gateway/WebUI 只参与需要用户确认的步骤或 snapshot 读取。

## 不应使用或引入的技术

| 不要使用 | 原因 | 替代方案 |
|---|---|---|
| LangGraph / AutoGen / CrewAI | 会绕开 ACP session、E2EE、WAL、permission，并引入新 runtime。 | Leader ACP session + team MCP tools。 |
| 新消息队列 | v1 是单用户本地 CLI 协作，队列增加部署和一致性成本。 | CLI SQLite/WAL + Socket.io RPC。 |
| Gateway 明文内容存储 | 破坏 E2EE 和 relay 边界。 | CLI/WebUI 可信域或 encrypted/source refs。 |
| WebUI 串多个 createSession 假装 team | 刷新/断线/失败恢复不可控，没有 MCP/mailbox/task。 | WebUI 创建 team intent，CLI 拥有 runtime。 |
| 复制成员 WAL 到 team WAL | 数据膨胀、顺序和密钥语义复杂。 | Team 只保存 member session refs。 |
| Gateway `CliRegistry` 做 truth | 进程内状态会在重启/多实例丢失。 | CLI TeamStore 持久化，Gateway 只缓存 presence。 |
| 修改全局 agent MCP 配置 | 会让普通 agent session 也看到 team tools，破坏隔离。 | 只在 team `session/new` 中用 MCP-over-ACP 或 per-session bridge 注入。 |
| 新状态库 Redux/XState/RxJS | 当前 React Query + Zustand 足够。 | 沿用现有前端模式。 |

## Testing / verification 栈建议

### Shared 类型

```bash
pnpm -C packages/shared build
pnpm -C packages/shared test:run
```

覆盖 status derivation、payload redaction、MCP-over-ACP/bridge capability helper、source refs。

### CLI

```bash
pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-mcp-server.test.ts
pnpm -C apps/mobvibe-cli test -- src/team/__tests__/mailbox-store.test.ts
pnpm -C apps/mobvibe-cli test -- src/team/__tests__/task-board-store.test.ts
pnpm -C apps/mobvibe-cli build
```

覆盖 MCP tool dispatch、per-session MCP declaration isolation、readiness、mailbox write/read/wake、task dependencies、capability gating、recovery。

### Gateway

```bash
pnpm -C apps/gateway test:run -- src/routes/__tests__/team-runs.test.ts
pnpm -C apps/gateway test:run -- src/services/__tests__/team-router.test.ts
pnpm -C apps/gateway build
```

覆盖 auth、machine ownership、RPC routing、plaintext rejection、generic errors。

### WebUI

```bash
pnpm -C apps/webui test:run -- src/__tests__/team-runs.test.tsx
pnpm -C apps/webui build
```

覆盖 create UI、MCP phase display、task/mailbox projection、member session navigation、permission blocker。

### 全仓库质量门禁

```bash
pnpm format
pnpm lint
pnpm build
```

## 分阶段落地建议

1. **协议和持久化先行**：shared 类型 + CLI TeamStore schema，不启动 agent。
2. **CLI MCP/mailbox/task 本地闭环**：tool call 能通过 MCP-over-ACP 或 per-session bridge 写 durable store 并上报 readiness。
3. **最小端到端 team run**：WebUI 创建 leader team，Gateway 路由，CLI 创建 leader ordinary session 并注入 MCP。
4. **受控 member spawn**：leader 请求 spawn，系统确认后创建 member ordinary session。
5. **生命周期和安全加固**：cancel/retry/archive、permission、E2EE、wake/idle、reconnect。
6. **UI polish**：移动端、任务板详情、mailbox 活动、Git/worktree、导出。

## 风险与验证重点

| 风险 | 建议 |
|---|---|
| MCP 注入不可用 | backend capability gating + readiness phase + degraded UI。 |
| Team tools 影响普通 agent | 只在 team `session/new` 声明 MCP server；普通 session 无 team server declaration。 |
| Mailbox/task 正文泄露 | shared payload 禁止 plaintext，Gateway 日志 redaction。 |
| Wake 失败导致消息丢失 | 持久化 delivery 和 wake 状态分离。 |
| Leader 滥用 spawn/shutdown | leader-only + 用户确认 + 成员数/同 workspace 限制。 |
| Gateway 重启丢 team | CLI TeamStore 为 truth；Gateway reconnect 后重新拉 snapshot。 |
| 大文件膨胀 | 新 team 模块保持小文件；UI 懒加载 Git/file/resource。 |

## 信息来源与信心

| 来源 | 用途 | 信心 |
|---|---|---|
| `.planning/research/AIONUI-ACP-TEAM.md` | team MCP、mailbox、task board、MCP transport gating | 高 |
| ACP RFD `https://agentclientprotocol.com/rfds/mcp-over-acp` | per-session MCP-over-ACP transport、`mcpCapabilities.acp`、id routing、bridge fallback | 高 |
| `.planning/PROJECT.md` | feature scope、E2EE/Gateway/CLI/WAL 约束 | 高 |
| `.planning/codebase/STACK.md` | 当前版本和技术栈 | 高 |
| `.planning/codebase/ARCHITECTURE.md` | 分层、数据流、状态归属 | 高 |
| Current shared/socket/session/CLI/WebUI code | 实现边界和测试命令 | 高 |

---
*Stack research updated: 2026-05-12 after AionUI ACP team correction*
