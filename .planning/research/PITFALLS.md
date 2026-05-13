# Mobvibe Agent Team：领域陷阱与失败模式

**领域:** 分布式 ACP 多 agent 团队协作
**项目:** Mobvibe Agent Team  
**研究日期:** 2026-05-12  
**总体置信度:** HIGH

## 结论摘要

Agent Team v1 最大风险不是“能否启动多个 ACP session”，而是错误地把 team 做成 prompt fan-out 和 UI 聚合，漏掉 per-session MCP 工具注入、durable mailbox、task board、wake/idle 和 backend MCP-over-ACP/bridge capability gating。没有这些能力，agents 不能主动协作，team 在重启或工具注入失败后也无法解释和恢复。

ACP 官方 MCP-over-ACP RFD 还引入一个关键隔离要求：team MCP server 应只声明在 team leader/member 的 `session/new` 中，普通 agent session 不声明该 server。任何修改全局 agent MCP 配置的方案都会让 team 功能影响其他 agent 使用，必须避免。

第二类高风险是安全边界退化：Gateway 为了展示 team summary、mailbox、task board 或 agent output 而接触明文内容。Mobvibe 必须保持 Gateway relay 边界，所有内容字段留在 WebUI/CLI 可信域或加密 payload 中。

第三类风险是生命周期和恢复：MCP readiness、mailbox delivery、task ownership、permission、cancel/retry/archive 都是 per-member 状态，不能用一个 team-level boolean 表达。

## 推荐阶段映射

| 阶段 | 名称 | 主要防线 |
|------|------|----------|
| Phase 1 | 协议、状态模型与持久化边界 | shared team/MCP/mailbox/task 类型、content boundary、CLI durable schema |
| Phase 2 | CLI Team MCP + Mailbox + Task Board | MCP server、tool policy、mailbox/task store、capability gating、readiness tests |
| Phase 3 | 最小端到端 Team Run | WebUI/Gateway/CLI 创建 leader session、MCP 注入、受控 spawn、team monitor |
| Phase 4 | 生命周期、权限、E2EE 与恢复 | cancel/retry/archive、wake/idle、permission attribution、missing key、reconnect |
| Phase 5 | UI 规模化与 v1 Polish | 移动端、订阅策略、任务板/邮箱详情、Git/worktree、导出 |

## Critical Pitfalls

### Pitfall 1: 只做 prompt fan-out，遗漏 team MCP server

**What goes wrong:**  
系统创建多个普通 session，并把全局目标和角色 prompt 分发给它们，但 agents 无法调用工具互发消息、创建任务、查询成员、spawn 队友或更新进展。用户得到的是“多个相关 session”，不是 team。

**Warning signs:**

- Phase 2 计划只有 `createSession` + `sendMessage`，没有 `TeamMcpServer`。
- 文档把 team 描述成“metadata/UI 聚合”，没有 mailbox/task board。
- 成员状态只能从自然语言输出推断，没有 tool-generated task/progress facts。
- Leader 无法动态创建成员，只能依赖用户预先配置所有 session。

**Prevention strategy:**

- Phase 2 必须先实现 CLI team MCP server、tool dispatch、mailbox store 和 task board store。
- Leader/member session 创建前必须通过 MCP-over-ACP 或 per-session bridge 注入 team MCP config。
- WebUI 展示 MCP readiness；未 `tools_ready` 的成员不能标记为可自治。
- Tool surface 至少覆盖 send message、task create/update/list、members、受控 spawn。

**Verification evidence:**

- CLI test：调用 `mobvibe_team_task_create` 后，task store 出现任务。
- CLI test：调用 `mobvibe_team_send_message` 后，mailbox 有消息且 wake status 被记录。
- E2E：leader 使用工具 spawn member，并通过 mailbox 给 member 分配任务。

### Pitfall 2: MCP 注入 readiness 被隐藏，team 卡死不可诊断

**What goes wrong:**  
Team MCP server 启动失败、MCP-over-ACP declaration 配置失败、stdio/HTTP bridge 配置失败、ACP session 不支持可用 MCP transport、工具列表未 ready，但 UI 只显示 member running。用户和后续 agent 无法判断是 agent 慢、工具不可用还是 session 已降级。

**Warning signs:**

- `TeamMemberStatus` 只有 `running/failed/completed`，没有 MCP phase。
- 创建 session 时写入 mcp config 失败只打日志，不进入 team snapshot。
- WebUI 没有 `degraded` 或 `mcp_tools_waiting` 状态。
- 后端能力检查只看 backendId，不看 `mcpCapabilities.acp` 或 per-session bridge 可用性。

**Prevention strategy:**

- 定义 `TeamMcpPhase`：server_starting/server_ready/session_injecting/tools_waiting/tools_ready/degraded/error。
- MCP phase 持久化在 CLI TeamStore，并通过 socket/RPC 投影到 WebUI。
- Backend capability gating 阻止不支持 native MCP-over-ACP 且无法 per-session bridge 的 backend 成为自治 leader/member。
- Tool calls 失败要返回结构化错误并写入 team/member error state。

**Verification evidence:**

- CLI test：模拟 MCP server 启动失败，member mcpPhase 为 `error`。
- WebUI test：`degraded` member 显示明确提示和 retry action。
- Shared test：不支持 native MCP-over-ACP 且无法 bridge 的 backend 不能通过 team-capable helper。

### Pitfall 3: 修改全局 agent MCP 配置，导致普通 session 也暴露 team tools

**What goes wrong:**  
为了让 team tools 可用，系统把 `mobvibe_team_*` MCP server 写入 agent 的全局 MCP 配置或长期用户配置。之后用户创建普通非 team session 时也能看到 team tools，工具调用没有 teamRunId/memberId 上下文，甚至误写某个旧 team 的 mailbox/task store。

**Warning signs:**

- 实现修改 Claude/Codex/Gemini 等 agent 的全局 MCP config 文件。
- 普通 `createSession` 路径也包含 `mobvibe-team` MCP server。
- MCP server id 不是 per team/session 生成，而是固定全局名称。
- Tool handler 在缺少 teamRunId/memberId 时尝试猜测当前 team。

**Prevention strategy:**

- 采用 MCP-over-ACP：只在 team `session/new` 的 `tools.mcpServers` 中声明 `transport: "acp"` 和 CLI 生成的 unique id。
- Bridge fallback 也必须只随该 team session 创建和销毁，不写全局配置。
- Tool handler 必须通过 server id / connection metadata 路由到具体 team/member，缺失上下文直接拒绝。
- 普通 session 创建测试必须断言没有 `mobvibe-team` MCP server declaration。

**Verification evidence:**

- CLI test：普通 createSession payload 不包含 team MCP server。
- CLI test：team session MCP server id 映射到唯一 `teamRunId/memberId/sessionId`。
- Integration：普通 agent session 看不到 `mobvibe_team_*` tools。

### Pitfall 4: Mailbox delivery 与 wake 结果混为一谈

**What goes wrong:**  
消息已经写入 mailbox，但 wake 目标 agent 失败，系统把整个发送标记为失败并重试，导致重复消息；或者 wake 失败被静默吞掉，成员永远不会处理 unread message。

**Warning signs:**

- `send_message` tool 返回前先 wake 再写 DB。
- Mailbox message 没有 `read`、`wakeStatus` 或 createdAt。
- wake rejection 被空 catch 掉。
- 重连后无法知道哪些消息已持久化但未读。

**Prevention strategy:**

- 先持久化 mailbox message，再 best-effort wake。
- 将 `accepted`、`wake_pending`、`wake_failed`、`read` 分离建模。
- wake 失败记录错误并暴露给 team monitor，但不回滚消息。
- 读取 unread messages 时原子标记 read，避免并发重复消费。

**Verification evidence:**

- CLI test：wake 抛错时 message 仍存在，wakeStatus 为 failed。
- CLI test：并发读取 unread 只消费一次。
- WebUI test：wake_failed 显示为可恢复状态，不丢失 message count。

### Pitfall 5: Task board 只存在于 leader 输出中，没有 durable store

**What goes wrong:**  
Leader 在自然语言里列任务，但系统没有任务事实来源。刷新后任务消失，成员无法查询任务板，summary 无法追溯任务状态，用户只能读 transcript 猜测进度。

**Warning signs:**

- 没有 `TeamTask` 类型或 task store。
- WebUI task board 从 leader message 中解析 markdown。
- 成员无法用 tool list tasks。
- blockedBy/owner/status 只存在 prompt 文本里。

**Prevention strategy:**

- Phase 1 定义 task 类型：taskId、teamRunId、subject/description ref、owner、status、blockedBy/blocks、timestamps。
- Phase 2 实现 `task_create/update/list` tools 和 store tests。
- WebUI 只根据 task store projection 展示任务状态，不从 transcript 推断。

**Verification evidence:**

- CLI test：task completed 后 unblock dependent tasks。
- WebUI test：刷新后 task board 从 snapshot 恢复。
- Gateway test：task payload 不接受 plaintext transcript 字段。

### Pitfall 6: Gateway 接触 prompt、mailbox、task、summary 或 output 明文

**What goes wrong:**  
为了方便展示或总结，Gateway route/DB/log 收到明文用户目标、成员 prompt、mailbox content、task description、agent output 或 summary body，破坏 E2EE 和 relay 边界。

**Warning signs:**

- Gateway `team_runs` 表包含 `prompt`, `message`, `taskDescription`, `summaryBody`, `assistantOutput`。
- Gateway route 命名为 `generateTeamSummary` 并接受 messages。
- Logger 记录完整 create team params 或 mailbox payload。
- Socket payload 直接广播 task/mailbox 正文。

**Prevention strategy:**

- Shared 类型区分 Gateway-facing metadata、encrypted payload、CLI-local content、source refs。
- Gateway validators 拒绝 plaintext content 字段。
- 日志 redaction helper 只保留 ids/counts/status/error code。
- Summary 只保存 source refs；正文在 WebUI/CLI 可信域或普通 ACP summarizer session 中生成。

**Verification evidence:**

- Gateway test：含 `prompt`/`content`/`transcript` 明文字段的 request 被拒绝。
- Static review：Gateway schema 不含明文内容列。
- Log test：redaction 移除 prompt/task/mailbox/summary/output。

### Pitfall 7: 非 team-capable backend 被加入自治 team

**What goes wrong:**  
某 ACP backend 不支持 native MCP-over-ACP，也无法通过 per-session bridge 安全接入，系统仍将其设为 leader/member。Agent 看不到 `mobvibe_team_*` tools，leader 无法协调，成员无法读取 mailbox/task。

**Warning signs:**

- 创建 team 只校验 backend 存在，不校验 capabilities。
- UI 允许任意 backend 作为 leader。
- CLI spawn member 失败后只显示 generic agent error。
- 没有 degraded fallback 文案。

**Prevention strategy:**

- 从 ACP initialize result 或 backend capability cache 暴露 `mcpCapabilities.acp`，并显式记录 bridge fallback 是否可用。
- Leader/member 创建和 spawn 前都做 capability check。
- 不支持 team transport 的 backend 显示为普通 session 可用，但不可作为自治 teammate。
- 如支持非自治成员，必须在 UI 中明确其不能使用 mailbox/task tools。

**Verification evidence:**

- Shared/CLI test：`mcpCapabilities.acp !== true` 且 bridge 不可用时 team-capable check false。
- WebUI test：不支持 backend 不能选择为 leader。
- CLI test：spawn 不支持 backend 返回 member-level validation error。

### Pitfall 8: 权限请求在 team UI 中丢失或误投递

**What goes wrong:**  
多个成员同时请求权限，UI 只显示一个 team-level permission，用户对 A 的 decision 被发给 B，或 cancel team 后 permission promise 悬挂。

**Warning signs:**

- UI key 只用 `requestId`，不含 `sessionId`。
- Team detail 有 “approve all” 但没有逐项 tool call 信息。
- Gateway 以 teamRunId 直接 approve permission。
- Cancel team 后 session permission 仍 pending。

**Prevention strategy:**

- Team permission projection 始终显示 `teamRunId/memberId/sessionId/requestId`。
- 决策仍走现有普通 session permission path。
- Cancel/retry/archive 时清理或取消对应 session pending permission。
- v1 不做无确认批量自动授权。

**Verification evidence:**

- CLI test：两个 session 同 requestId 只 resolve 对应 `sessionId:requestId`。
- WebUI test：两个成员 permission 同时显示，approve A 不影响 B。
- Integration：cancel team 后 pending permission 进入 cancelled。

### Pitfall 9: Team cancel/retry/archive 只改聚合状态

**What goes wrong:**  
Team 标记 cancelled，但 MCP server 仍运行、成员 session 仍输出、mailbox wake 仍 pending、permission promise 仍挂起。重试复用旧 session 污染 WAL revision；归档误删成员历史。

**Warning signs:**

- `team.status = cancelled` 后没有 per-member allSettled 结果。
- Retry 复用同一个 `sessionId`。
- Archive 默认删除成员 session WAL、mailbox 和 task history。
- MCP server dispose 失败不进入 degraded/error。

**Prevention strategy:**

- Lifecycle 操作按 member 执行并记录 result。
- Retry 默认新建 session/attempt，重新注入 MCP。
- Archive 默认只归档 team projection，保留成员 WAL/mailbox/task refs。
- Dispose MCP server、取消 wake、取消 permission、停止 running sessions 都要显式处理。

**Verification evidence:**

- CLI test：cancel team 调用 running member session cancel，并停止 MCP server。
- WAL test：retry 新 session 不污染旧 revision。
- WebUI test：partial cancel failure 显示具体 member。

### Pitfall 10: WebUI 把 team transcript 和内容塞进 chat-store/localStorage

**What goes wrong:**  
Team store 保存完整成员 messages、mailbox 正文、task 正文和 summary body，localStorage 膨胀且敏感内容长期暴露；chat-store 与 team 状态耦合导致渲染和恢复复杂化。

**Warning signs:**

- `ChatSession` 扩展出完整 `teamMembers.messages`。
- Team detail 初始渲染复制所有成员 transcript。
- localStorage 保存 task/mailbox 正文。
- `useSocket` 同时处理 session WAL 和 team mailbox/task reducers。

**Prevention strategy:**

- 独立 team store，只保存 projection、counts、refs、selected IDs、MCP phase。
- 成员 transcript 始终通过 `sessionId` 从现有 session store/WAL 获取。
- Task/mailbox 正文按需从可信域加载，默认不持久化到 localStorage。

**Verification evidence:**

- WebUI store test：team state 不包含 transcript arrays。
- Performance check：多成员 team 不让 localStorage 随 transcript 线性增长。
- E2E：刷新后 projection 恢复，成员内容按 session backfill 恢复。

### Pitfall 11: Worktree 和 spawn 策略不受控

**What goes wrong:**  
Leader 无限 spawn 成员，多个成员共享 cwd 并行修改同一文件，或自动 worktree 命名冲突留下垃圾目录。用户无法理解哪个成员改了哪里。

**Warning signs:**

- `spawn_member` 没有成员数上限、用户确认或 workspace 限制。
- 并行成员默认共享 cwd 且无风险提示。
- worktree branch/path 不包含 team/member/attempt。
- 创建失败后 orphan worktree 没有记录。

**Prevention strategy:**

- `spawn_member` leader-only，并受成员数、workspace、backend capability 和用户确认约束。
- 并行默认 isolated worktree；shared cwd 必须显式确认。
- Worktree 命名包含 teamRunId/memberId/attempt。
- 失败补偿记录 orphan worktree path 和清理建议。

**Verification evidence:**

- CLI test：spawn 超过 limit 被拒绝。
- CLI test：retry 生成不同 worktree branch/path。
- UI test：shared cwd 显示冲突风险。

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Verification |
|-------------|----------------|------------|--------------|
| Phase 1 协议 | 类型只覆盖 team/member，漏掉 MCP/mailbox/task | shared 类型必须含 readiness、mailbox、task、tool policy | tsc + type tests |
| Phase 1 安全 | Gateway-facing payload 混入 content | content boundary 和 validators | Gateway rejection tests |
| Phase 2 MCP | tool dispatch 无 caller identity | MCP-over-ACP server id / bridge metadata + policy check | CLI tool policy tests |
| Phase 2 Isolation | team tools 泄露到普通 session | 只在 team `session/new` 声明 MCP server | ordinary session isolation test |
| Phase 2 Mailbox | wake 失败导致消息丢失或重复 | persistence 与 wake 状态分离 | wake failure test |
| Phase 2 Task | 从 transcript 解析任务 | durable task board store | task store tests |
| Phase 3 E2E | MCP 未 ready 就发送目标 | 等 readiness 或显示 degraded | E2E readiness test |
| Phase 3 Spawn | leader 绕过用户确认 | policy + confirmation flow | spawn confirmation test |
| Phase 4 Permission | approve 误投递 | sessionId/requestId 决策 | dual permission tests |
| Phase 4 Recovery | Gateway 重启丢 team | CLI TeamStore snapshot restore | reconnect tests |
| Phase 5 UI | 首屏拉取重型 Git/file/content | projection first, details lazy load | network assertions |

## Verification Checklist for Roadmap

- [ ] 每个 cross-process payload 先进入 `packages/shared`。
- [ ] Team run、member、MCP readiness、mailbox、task board 有 CLI durable owner。
- [ ] Leader/member 是普通 ACP session，继续使用现有 WAL/E2EE/permission。
- [ ] Backend MCP-over-ACP / per-session bridge capability gating 在创建 leader/member 和 spawn 时生效。
- [ ] 普通非 team session 不包含 `mobvibe-team` MCP server declaration。
- [ ] Team MCP server 有 readiness phase、caller identity、tool policy 和 dispose/recovery。
- [ ] Mailbox delivery 和 wake 状态分离，并覆盖 wake failure。
- [ ] Task board 是 durable store，不从 transcript 解析。
- [ ] Gateway 不解密、不记录、不存储 prompt、mailbox、task、summary 或 output 明文。
- [ ] Permission UI/RPC 永远携带 session/member 归属。
- [ ] Cancel/retry/archive 有 per-member allSettled 结果和补偿策略。
- [ ] WebUI team store 不复制成员 transcript 到 localStorage。
- [ ] 多成员并发、spawn、worktree 和重型 Git/file/resource RPC 受限或懒加载。

## Sources

- `.planning/research/AIONUI-ACP-TEAM.md` — AionUI team MCP、mailbox、task board、readiness 和 backend gating。
- `.planning/PROJECT.md` — 项目目标、约束、active requirements。
- `.planning/codebase/ARCHITECTURE.md` — WebUI/Gateway/CLI/ACP 分层。
- `.planning/codebase/CONCERNS.md` — WAL/backfill、permission、E2EE、Gateway registry 风险。
- Current Mobvibe session/router/WAL/WebUI state patterns.
- ACP RFD `https://agentclientprotocol.com/rfds/mcp-over-acp` — per-session MCP-over-ACP transport, `mcpCapabilities.acp`, routing by server id, and bridge fallback.

---
*Pitfall research updated: 2026-05-12 after AionUI ACP team correction*
