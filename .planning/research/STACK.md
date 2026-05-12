# Agent Team 编排技术栈建议

**项目:** Mobvibe Agent Team  
**研究维度:** Stack / libraries / protocol boundaries  
**研究日期:** 2026-05-12  
**总体结论:** v1 不引入新的编排框架或消息系统；在现有 TypeScript monorepo 内扩展 shared 协议类型、Gateway 路由层、CLI SessionManager/WAL、WebUI React Query/Zustand/Socket.io 模式。

## 推荐栈结论

Agent team 编排应当被实现为“跨多个普通 ACP session 的轻量业务层”，而不是新建第二套 agent runtime。现有产品已经有稳定边界：WebUI 通过 HTTP + Socket.io 到 Gateway，Gateway 用 `SessionRouter` 转 RPC 到本地 CLI daemon，CLI 用 ACP SDK 管理真实 agent 进程并把 session 事件写入 SQLite WAL。团队运行只应该新增 team 元数据、成员 session 映射、编排状态和 summary 引用，底层消息、权限、E2EE、文件/Git 能力继续走现有 session 链路。

**不建议新增依赖。** 当前仓库已有足够能力：TypeScript 5.9、Socket.io 4.8、React 19、React Query 5、Zustand 5、Drizzle/PostgreSQL、CLI 本地 SQLite WAL、ACP SDK 0.16.1、pino、Vitest/Bun test/Playwright。新增依赖会扩大协议面和运行时复杂度；v1 的关键风险是状态一致性和安全边界，不是缺少库。

## 现有版本基线（来自仓库文件）

| 类别 | 现有技术 | 版本/约束 | v1 Agent Team 用法 |
|---|---|---:|---|
| Monorepo | pnpm + Turborepo | pnpm 10.32.1、turbo ^2.7.4 | 沿用 workspace 包边界；先改 `@mobvibe/shared` 再改 apps。 |
| 语言 | TypeScript | ~5.9.3 | 所有 team 协议和状态都用显式类型；禁止 `any`，未知 payload 用 `unknown` 后收窄。 |
| Gateway runtime | Node.js | 根目录要求 >=22.12.0 | Gateway 只做鉴权、路由、非内容元数据持久化；不执行 agent。 |
| CLI runtime | Bun | CLI build/test/runtime 脚本使用 Bun | 本地 team 编排可以在 CLI 内复用 SessionManager，但不要依赖 Node-only 新库。 |
| HTTP API | Express | ^4.21.2 | 新增 `/acp/team-runs` 类 REST 端点用于创建/读取/取消/归档 team run。 |
| Realtime | Socket.io | gateway/client ^4.8.1 | 新增 typed team status events；继续用现有 `/webui` 和 `/cli` namespace。 |
| ACP runtime | `@agentclientprotocol/sdk` | ^0.16.1 | 成员仍是普通 ACP session；不要绕开 ACP 或写 backend 私有适配。 |
| Frontend | React + Vite | React ^19.2.0、Vite ^8.0.2 | Team UI 用现有 hooks/store/component 模式。 |
| Server state | `@tanstack/react-query` | ^5.83.0 | Team run 列表、详情、创建/取消 mutation 用 React Query。 |
| Client state | Zustand | ^5.0.8 | 实时 member 状态、展开状态、选中 team run 可放 team store；不要塞进 chat store 的 message 主模型。 |
| Gateway DB | Drizzle ORM + PostgreSQL | drizzle-orm ^0.41.0、drizzle-kit ^0.31.4、pg ^8.13.0 | 如果 team 元数据需要跨 Gateway 重启恢复，用 Gateway DB 存“非内容 metadata”。 |
| CLI persistence | SQLite WAL via `WalStore` | 已有本地实现 | 成员 session 事件继续写各自 WAL；team 不复制聊天历史。 |
| Logging | pino | ^9.6.0 | Gateway/CLI team 操作用结构化日志，避免记录 prompt 明文、token、密钥。 |
| Formatting/lint | Biome | 2.3.11 | 继续 `pnpm format && pnpm lint`；不要引入 ESLint/Prettier。 |
| Tests | Vitest / Bun test / Playwright | Vitest ^2.1.8、Playwright ^1.58.2 | Gateway/WebUI/shared 用 Vitest；CLI 用 Bun test；关键 UI flow 再用 Playwright。 |

## 应扩展的现有包和模块

### 1. `packages/shared`：先定义 team 协议边界

**建议新增文件:** `packages/shared/src/types/team-run.ts`，并从 `packages/shared/src/index.ts` 导出。

应该定义：

- `TeamRunId`、`TeamMemberId`。
- `TeamRunStatus`: `draft | queued | running | cancelled | failed | completed | archived`。
- `TeamMemberStatus`: `pending | creating_session | running | waiting_permission | cancelled | failed | completed`。
- `TeamExecutionMode`: v1 建议先支持 `sequential` 和简单 `parallel`，不要做 autonomous planner。
- `TeamRunSummary`: 列表页用，不包含明文 agent 输出。
- `TeamRunDetail`: 包含成员配置、member -> session 映射、状态、错误、summary session 或 summary 文档引用。
- `TeamMemberConfig`: `backendId`、`role`、`prompt` 或 encrypted prompt reference、`order`、`cwd`、`worktree`、`modelId?`、`modeId?`。
- `CreateTeamRunParams`、`CreateTeamRunResponse`、`CancelTeamRunParams`、`RetryTeamMemberParams` 等 REST/RPC payload。
- `TeamRunChangedPayload`、`TeamMemberChangedPayload` 等 socket payload。

**为什么放 shared:** 现有架构明确要求跨 WebUI/Gateway/CLI payload 先进入 `@mobvibe/shared`。如果 team 类型散落在 app 文件里，Gateway、CLI、WebUI 很快会在状态字段、错误 shape、session 映射上漂移。

**避免:** 不要把 team 类型定义在 `apps/webui/src/lib/api.ts` 或 `apps/gateway/src/routes/*` 内；这些只是消费端。

### 2. `packages/shared/src/types/session.ts`：最小扩展 session 元数据

现有 `SessionSummary` 已有 `sessionId`、`backendId`、`machineId`、`cwd`、`workspaceRootCwd`、`worktreeSourceCwd`、`worktreeBranch`、`revision`、`wrappedDek`。v1 可以新增可选 team 关联字段：

- `teamRunId?: string`
- `teamMemberId?: string`
- `teamRole?: string`

**为什么是可选字段:** 保持所有普通 session 不受影响，且 WebUI 可以从普通 session 跳回所属 team run。不要把完整 team 配置嵌入每个 `SessionSummary`，否则 session list 会变成 team store 的副本。

### 3. `packages/shared/src/types/socket-events.ts`：只新增必要的 typed events/RPC

建议新增：

- WebUI -> Gateway: `subscribe:team-run`、`unsubscribe:team-run`。
- Gateway -> WebUI: `team-run:changed`、`team-member:changed`。
- Gateway -> CLI RPC: `rpc:team-run:start`、`rpc:team-run:cancel`、可选 `rpc:team-member:retry`。
- CLI -> Gateway RPC response 继续复用 `rpc:response`。

**更保守的 v1 选择:** 如果创建 team run 完全由 Gateway 逐个调用既有 `rpc:session:create` + `rpc:message:send` 完成，则可以不新增 Gateway -> CLI team RPC；但 CLI 端需要知道同一 team 的成员 session 关系时，仍要通过 create session params 或 follow-up RPC 传入 metadata。

**推荐边界:** Gateway 发起 team orchestration 的 HTTP intent，CLI 负责本地 session 创建、worktree、WAL 和 ACP 交互。不要让 WebUI 直接连续调用多个普通 session API 来“假装”创建团队，因为这样会绕过统一状态、失败恢复和权限处理。

### 4. `apps/gateway/src/services/session-router.ts`：复用 RPC broker，不膨胀成 Team God Object

现有 `SessionRouter` 已经负责把用户意图转换为 CLI RPC，并有 pending RPC timeout、user-scoped machine/session lookup。Team v1 可以：

- 在 `SessionRouter` 上增加必要的低层方法，例如 `createTeamMemberSession(...)` 内部复用 `createSession(...)`。
- 或新增 `apps/gateway/src/services/team-run-service.ts`，组合 `SessionRouter` 和 DB service；这是更推荐的边界。

**推荐:** 新建 `TeamRunService`，不要继续把 1000+ 行的 `SessionRouter` 扩展成包含 team 状态机的大类。`SessionRouter` 保持“RPC bridge”，`TeamRunService` 负责 team 状态、排序、成员失败策略、DB persistence。

### 5. `apps/gateway/src/db/schema.ts` / Drizzle：只存非内容 team 元数据

Gateway registry 是 ephemeral，`.planning/PROJECT.md` 已明确 team 元数据如果要跨重启恢复不能只放 Gateway 内存。建议在 Gateway PostgreSQL 中新增：

- `team_runs`: `id`、`user_id`、`machine_id`、`workspace_root_cwd`、`title`、`status`、`execution_mode`、`created_at`、`updated_at`、`archived_at?`。
- `team_members`: `id`、`team_run_id`、`backend_id`、`role`、`order_index`、`session_id?`、`status`、`worktree_enabled`、`worktree_branch?`、`error_code?`、`created_at`、`updated_at`。

**重要安全约束:** 不要在 Gateway DB 存储明文用户任务、成员 prompt、agent 输出或 summary 正文，除非它们已经经过与现有 session 一致的 E2EE 处理。Gateway 可以存可展示的非敏感 metadata，如 role 名、backendId、状态、sessionId、错误 code。

### 6. `apps/mobvibe-cli/src/acp/session-manager.ts`：复用 session 生命周期和 WAL

CLI 侧应继续把每个 team member 展开为普通 `createSession` + `sendMessage` 流程：

- worktree 继续使用现有 `CreateSessionWorktreeOptions` 和 `createGitWorktree`。
- 每个成员 session 继续独立 `revision`、`seq`、WAL、DEK、permission request。
- team 状态只引用成员 session，不复制或合并底层 WAL events。

**建议新增模块:** `apps/mobvibe-cli/src/team/team-run-manager.ts`。它组合 `SessionManager`，负责：按 order 启动成员、等待 `turn_end` 或失败、取消所有 running members、把 member 状态变更回报给 Gateway。

**为什么不直接改 SessionManager:** `SessionManager` 已经承担连接池、ACP session、WAL、权限、worktree、discovery、load/reload。继续塞 team 状态机会让权限、WAL 和编排失败恢复耦合在一起。

### 7. `apps/webui/src/lib/api.ts`：新增 team REST client，不改 E2EE 边界

建议在现有 API client 中新增：

- `createTeamRun(payload: CreateTeamRunParams): Promise<CreateTeamRunResponse>`
- `fetchTeamRuns(): Promise<TeamRunsResponse>`
- `fetchTeamRun(id: string): Promise<TeamRunDetail>`
- `cancelTeamRun(id: string): Promise<TeamRunDetail | { ok: boolean }>`
- `archiveTeamRun(id: string): Promise<{ ok: boolean }>`

**E2EE 约束:** 如果 member prompt 属于 session content，应像 `sendMessage` 一样在 WebUI 端加密为 `EncryptedPayload`，Gateway 只转发。不要把明文 prompt 当普通 JSON body 穿过 Gateway。若 v1 为简单实现必须让 Gateway 编排成员 prompt，则需要把 prompt 定义为非敏感配置并在产品上明确告知；但这与现有 E2EE 价值冲突，不推荐。

### 8. `apps/webui/src/lib/socket.ts` 和 hooks/store

新增 typed 方法：

- `subscribeTeamRun(teamRunId)`
- `unsubscribeTeamRun(teamRunId)`
- `onTeamRunChanged(listener)`
- `onTeamMemberChanged(listener)`

建议新增：

- `apps/webui/src/hooks/use-team-runs.ts`：React Query 查询和 mutation。
- `apps/webui/src/lib/team-run-store.ts`：Socket 增量状态、当前选择、UI 展开状态。
- Team UI 组件放在 `apps/webui/src/components/team/` 或现有 app feature 目录下。

**避免:** 不要在组件中直接 `io()` 创建第二个 Socket.io 连接；继续使用 `gatewaySocket` singleton。

## 协议边界建议

### HTTP：用户意图和快照读取

用 HTTP/REST 表达离散操作：创建 team run、读取列表/详情、取消、重试、归档。理由：现有 `apps/webui/src/lib/api.ts` 已集中处理 auth、Tauri bearer token、错误 shape 和 timeout；React Query 也适合这些 request/response 操作。

推荐路径（命名可在实现前再统一）：

```text
GET    /acp/team-runs
POST   /acp/team-runs
GET    /acp/team-runs/:teamRunId
POST   /acp/team-runs/:teamRunId/cancel
POST   /acp/team-runs/:teamRunId/archive
POST   /acp/team-runs/:teamRunId/members/:memberId/retry
```

### Socket.io：实时状态和订阅

用 Socket.io 只传 team status delta，不传大段明文输出。成员输出继续通过现有 `session:event`，WebUI 根据 `member.sessionId` 订阅对应 session。

推荐事件：

```text
subscribe:team-run
unsubscribe:team-run
team-run:changed
team-member:changed
```

### CLI RPC：本地执行能力

如果 Gateway 只是逐个 create/send，可先复用既有 RPC；如果需要 CLI 原子地处理“顺序启动多个 member + worktree + cancel all”，则新增 team RPC 更稳：

```text
rpc:team-run:start
rpc:team-run:cancel
rpc:team-member:retry
```

**推荐 v1 路线:** 第一阶段 Gateway `TeamRunService` 复用既有 session RPC 做最小闭环；第二阶段如果发现断线/取消/顺序等待复杂，再把编排下沉到 CLI `TeamRunManager` 并新增 team RPC。这样能先验证 UX 和数据模型，避免过早设计复杂分布式状态机。

## 不应使用或引入的技术

| 不要使用 | 原因 | 替代方案 |
|---|---|---|
| LangGraph / AutoGen / CrewAI 等 agent orchestration 框架 | 当前产品是 ACP WebUI + 本地 agent 进程控制；这些框架会绕开 ACP、E2EE、WAL、权限模型，并引入 Python/服务端 agent 执行假设。 | 用现有 ACP session 作为成员执行单元，team 层只做编排和状态聚合。 |
| 新消息队列（BullMQ、RabbitMQ、NATS、Kafka） | v1 是单用户本地 CLI 编排；Gateway 已有 Socket.io RPC，CLI 已有 WAL。队列会引入部署和一致性成本。 | HTTP + Socket.io RPC + Gateway DB metadata + CLI WAL。 |
| Gateway 存储/解析明文 prompt 或 agent 输出 | 破坏现有 E2EE 边界；Gateway 设计为 relay，不应理解会话内容。 | WebUI/CLI 端加解密；Gateway 只存 team metadata 和 sessionId 引用。 |
| 直接在 WebUI 串联多个 `createSession`/`sendMessage` 实现 team | 状态分散在浏览器，刷新/断线后难恢复；权限、取消、失败策略不可控。 | WebUI 创建 team intent；Gateway/CLI 负责权威状态。 |
| 复制成员 WAL 到 team WAL | 数据膨胀、顺序一致性和 E2EE key 管理复杂；summary 回链也会变脆。 | Team 只保存 member -> session 映射；原始上下文从各 session WAL 回放。 |
| 把 team run 全放 Gateway `CliRegistry` 内存 | Gateway 重启/多实例下丢状态；已有文档明确 registry 不是 durable storage。 | Gateway DB 存 team metadata；CLI WAL 存 session events。 |
| 为每个 team run 新建 Socket.io namespace | 现有 `/webui` 和 `/cli` 已满足鉴权和订阅；动态 namespace 增加连接管理复杂度。 | 在现有 namespace 上加 typed subscription event。 |
| Redux / XState / RxJS | 当前 WebUI 已是 React Query + Zustand；新增状态库只会提高认知成本。 | React Query 管 server snapshot，Zustand 管 realtime/UI projection。 |
| OpenAPI/tRPC/GraphQL 重写 API | 当前 API 已有 typed shared payload + `requestJson`；重写不服务 v1 目标。 | 继续 shared types + Express routes + typed API functions。 |

## Testing / verification 栈建议

### Shared 类型

共享类型多为编译期约束；如果新增 Zod validator 或 worktree/team helper，应在 `packages/shared` 加 Vitest。

```bash
pnpm -C packages/shared build
pnpm -C packages/shared test:run
```

### Gateway

覆盖：team run 创建鉴权、machine ownership、member session RPC 编排、DB persistence、cancel/retry 状态转换、RPC timeout/partial failure。

```bash
pnpm -C apps/gateway test:run -- src/services/__tests__/team-run-service.test.ts
pnpm -C apps/gateway test:run
pnpm -C apps/gateway build
```

### CLI

覆盖：顺序/并行 member 启动、worktree 参数传递、ACP backend 不支持能力时的失败状态、取消时关闭 running sessions、permission request 映射仍回到 member session。

```bash
pnpm -C apps/mobvibe-cli test -- src/team/__tests__/team-run-manager.test.ts
pnpm -C apps/mobvibe-cli build
```

### WebUI

覆盖：创建表单、backend/member 配置、team list/detail 状态渲染、socket delta 应用、从 member 跳转到 session、错误展示。

```bash
pnpm -C apps/webui test:run -- src/__tests__/team-runs.test.tsx
pnpm -C apps/webui test:run
pnpm -C apps/webui build
```

### 全仓库质量门禁

```bash
pnpm format
pnpm lint
pnpm build
```

如果改到 team 创建端到端 UI，再补 Playwright：

```bash
pnpm -C apps/webui test:e2e -- tests/e2e/team-run.spec.ts
```

## 分阶段落地建议

1. **协议和持久化先行**  
   在 `@mobvibe/shared` 定义 team 类型，在 Gateway DB 存 team run/member metadata。先不要做复杂 UI。

2. **最小端到端 team run**  
   WebUI 创建一个 sequential team run；Gateway 逐个复用 `SessionRouter.createSession` + `sendMessage`；成员 session 继续走 WAL/E2EE/session events。

3. **实时观察和权限状态**  
   加 `subscribe:team-run` 和 team delta events；WebUI team detail 聚合 member status，同时 member 输出仍从 session event 读取。

4. **取消/重试/归档**  
   基于 member sessionId 调 existing cancel/archive RPC；只在必要时新增 CLI `TeamRunManager`。

5. **Summary**  
   v1 先把 summary 做成 team metadata 中的“summary session 引用”或 WebUI 本地生成的加密 summary payload；不要让 Gateway 汇总明文输出。

## 风险与验证重点

| 风险 | 建议 |
|---|---|
| Team prompt 明文穿过 Gateway | 明确 prompt 是否属于 E2EE session content；推荐沿用 `EncryptedPayload`，Gateway 不解密。 |
| Sequential team 等待条件不稳定 | 以 `turn_end` / `session_error` / cancel result 作为明确状态边界，不靠字符串输出判断。 |
| 部分 backend 能力不一致 | 继续读取 `AgentSessionCapabilities`；UI 创建前提示不支持 load/list/prompt image 等能力差异。 |
| Gateway 多实例/重启 | Team metadata 放 PostgreSQL；live event 可断线后通过 team detail + session WAL backfill 恢复。 |
| 大文件继续膨胀 | 新增 `team-run-service.ts`、`team-run-manager.ts`、`team-run-store.ts`，不要把所有逻辑塞进现有大文件。 |

## 信息来源与信心

| 来源 | 用途 | 信心 |
|---|---|---|
| `.planning/PROJECT.md` | feature scope、E2EE/Gateway/CLI/WAL 约束、out of scope | 高 |
| `.planning/codebase/STACK.md` | 当前版本和技术栈 | 高 |
| `.planning/codebase/ARCHITECTURE.md` | 分层、数据流、反模式、状态归属 | 高 |
| `.planning/codebase/CONVENTIONS.md` | 命名、格式化、测试、错误处理约定 | 高 |
| `packages/shared/src/types/session.ts` | SessionSummary、capabilities、worktree/session metadata | 高 |
| `packages/shared/src/types/socket-events.ts` | Socket.io/RPC typed event 边界 | 高 |
| `apps/mobvibe-cli/src/acp/session-manager.ts` | CLI session lifecycle、WAL、worktree、E2EE、permissions | 高 |
| `apps/gateway/src/services/session-router.ts` | Gateway RPC bridge 和 user-scoped routing | 高 |
| `apps/webui/src/lib/api.ts` | REST client、E2EE sendMessage、timeout/error pattern | 高 |
| package.json 文件 | 版本、脚本、测试框架 | 高 |

**未使用外部文档原因:** 本研究问题是 brownfield stack/protocol boundary 选择，版本和能力必须以仓库文件为准；没有推荐新第三方库，因此无需为新库做外部文档验证。
