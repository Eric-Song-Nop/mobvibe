# ACP SDK 0.16.1 升级记录与后续能力候选

## 背景与结论

- 确认日期：2026-03-17。
- 本次将 `@agentclientprotocol/sdk` 从 `^0.14.1` 升级到 `^0.16.1`。
- 升级范围限定为“依赖 bump + 兼容修正 + 文档沉淀”，不引入新的用户可见 ACP 功能，不调整 Gateway / WebUI / CLI 现有交互流程。
- 本轮实际代码改动仅覆盖：
  - CLI 对 SDK 0.16.1 稳定化接口的兼容适配。
  - shared 中 `Plan*` 类型来源切换到 SDK 官方导出。
  - 升级事实与后续 ACP / RFD 能力候选的记录。

## 本次升级落地内容

### 1. SDK 依赖升级

- `apps/mobvibe-cli/package.json`
- `packages/shared/package.json`

两处依赖统一升级为 `@agentclientprotocol/sdk@^0.16.1`，未顺带刷新其他业务依赖，目的是把变更面控制在 ACP SDK 自身。

### 2. CLI 兼容修正

在 `apps/mobvibe-cli/src/acp/acp-connection.ts` 中完成了两类兼容修正：

- `unstable_listSessions` 切换为稳定接口 `listSessions`
- `KillTerminalCommandRequest` / `KillTerminalCommandResponse` 切换为 `KillTerminalRequest` / `KillTerminalResponse`

这些改动只处理 SDK API 命名与类型演进，不改变现有：

- `session/list`
- `session/load`
- `usage_update`
- `plan`
- `available_commands_update`

等运行逻辑。

### 3. Shared 类型对齐

在 `packages/shared/src/types/acp.ts` 中，`Plan` / `PlanEntry` / `PlanEntryPriority` / `PlanEntryStatus` 不再由仓库本地手写维护，改为直接复用 SDK 0.16.1 根入口已经正式导出的类型。

保留原有对外导出名，因此对 `apps/webui` 和其他消费者而言，import 路径与命名不变；变化只发生在实现来源上。

### 4. 运行时校验入口核对

已检查 `packages/shared/src/validation/acp-schemas.ts` 使用的深导入：

- `@agentclientprotocol/sdk/dist/schema/zod.gen.js`

在 0.16.1 包内容中仍然存在，`zSessionNotification` 仍可从该路径获取，因此本轮未改动验证实现，以避免无收益的重构。

## 已确认值得后续接入的 ACP / RFD 能力

以下能力均已在 2026-03-17 基于 ACP 官方协议文档和 SDK 0.16.1 包内容完成一轮确认；它们有明确产品价值，但本轮升级刻意不接入，原因是本次目标是兼容性升级，不扩展用户可见行为。

### 1. `authMethods` / `authenticate`

#### 能力说明

- Agent 可以在初始化阶段通过 `authMethods` 宣告认证方式。
- Client 可通过 `authenticate` 完成认证，再继续创建会话。

#### 在 Mobvibe 的潜在落点

- CLI 作为 ACP client，可在连接本地/远端 agent 时识别认证需求。
- Gateway 可把认证状态暴露到会话状态流，辅助 WebUI 展示“待认证 / 已认证 / 认证失败”。
- WebUI 可补一层引导界面，例如浏览器 OAuth 跳转、终端认证提示、环境变量缺失提示。

#### 预估影响面

- `apps/mobvibe-cli`
- `packages/shared`
- `apps/gateway`
- `apps/webui`
- 可能还包括 WAL/会话状态持久化字段

#### 本轮暂缓原因

- 会直接引入新的用户状态机与错误流转，不属于“兼容升级”。
- 需要先统一 Mobvibe 对“认证失败是否阻塞会话创建”的产品语义。
- 需要确认认证态是否跨进程、跨设备同步。

### 2. `session/set_config_option`

#### 能力说明

- Client 可以在会话建立后，按协议更新 agent 暴露的配置项，并收到完整的最新配置状态。

#### 在 Mobvibe 的潜在落点

- WebUI 中的模型、模式、审批策略或 agent 特定选项面板。
- Gateway Socket 层可以把配置项变更广播给多个观察者。
- CLI 可以把当前 agent 暴露的 config option 做成本地 capability snapshot。

#### 预估影响面

- `apps/mobvibe-cli` 的 ACP 连接层与 socket client
- `apps/gateway` 的会话控制 RPC / 广播
- `apps/webui` 的设置面板与状态同步
- `packages/shared` 的 socket payload / capability 类型

#### 本轮暂缓原因

- 需要先定义 Mobvibe 自己的“哪些配置由 ACP 原生驱动，哪些由平台层托管”。
- 一旦暴露 UI，就会形成新的持久化与多端同步语义。
- 当前仓库已有 mode/model 相关流程，直接接入容易和现有抽象交叉。

### 3. `session/close`

#### 能力说明

- ACP 协议已经定义显式关闭会话能力，SDK 0.16.1 仍以 `unstable_closeSession` 形式暴露。

#### 在 Mobvibe 的潜在落点

- WebUI 会话列表中的“关闭会话”动作。
- Gateway 清理后台连接与会话占用资源。
- CLI 在 agent 支持时主动结束远端 session，而不是只做本地断联。

#### 预估影响面

- `apps/mobvibe-cli` ACP 连接封装
- `apps/gateway` 会话生命周期管理
- `apps/webui` 会话列表 / 会话详情交互
- 可能波及 WAL 保留策略和“关闭后是否仍可 load”语义

#### 本轮暂缓原因

- SDK 侧仍处于 `unstable_` 命名，不适合在这次“稳定兼容升级”里接入产品面流程。
- 关闭语义会影响现有“断开连接”和“删除本地索引”的区别，需要单独设计。

### 4. prompt `messageId` / `userMessageId`

#### 能力说明

- `PromptRequest` 可传入 `messageId`。
- Agent 在 `PromptResponse` / 相关更新中可回传 `userMessageId`，用于把一次用户输入与后续消息流稳定关联。

#### 在 Mobvibe 的潜在落点

- Gateway / WebUI 的消息去重、断线重放、并发 prompt 对齐。
- WAL 中把单次 prompt 与后续 `session/update` 更稳定地归档。
- 多端观察同一会话时，对消息归属做更精确关联。

#### 预估影响面

- `apps/gateway` 的消息桥接与 WAL
- `apps/webui` 的消息列表归并逻辑
- `apps/mobvibe-cli` 的 socket 协议映射
- `packages/shared` 的消息与会话更新类型

#### 本轮暂缓原因

- 需要先厘清现有前端消息主键、socket 事件顺序与 WAL 回放策略。
- 一旦落地，应该成体系调整消息归并逻辑，而不是只加字段。

## 为何这轮只做兼容升级

- 本次目标是先把 SDK 升到 0.16.1，并保持现有产品行为稳定。
- ACP 新能力虽然有价值，但都涉及会话生命周期、认证、配置或消息主键语义，落地时会跨 CLI / Gateway / WebUI。
- 如果把这些能力和依赖升级捆绑在一起，回归成本会明显扩大，不利于定位问题。

因此，本轮以“升级基础设施、确认后续候选、避免产品面行为漂移”为边界，下一轮再单独挑选能力做设计和实现。

## 升级事实来源

确认日期均为 2026-03-17。

### 版本确认

- npm 包页：<https://www.npmjs.com/package/@agentclientprotocol/sdk>
- 本地执行：`pnpm view @agentclientprotocol/sdk version`
- 结果：最新稳定版本为 `0.16.1`

### 协议与 SDK 参考

- ACP TypeScript SDK 文档：<https://agentclientprotocol.github.io/typescript-sdk/>
- ACP 更新页：<https://agentclientprotocol.com/docs/updates>
- ACP 协议初始化文档：<https://agentclientprotocol.com/protocol/initialization>
- ACP 协议会话配置文档：<https://agentclientprotocol.com/protocol/session-config>
- ACP 协议会话关闭文档：<https://agentclientprotocol.com/protocol/session-setup#closing-sessions>
- ACP prompt turn 文档：<https://agentclientprotocol.com/protocol/prompt-turn>

### SDK 0.16.1 包内容核对

基于 `https://registry.npmjs.org/@agentclientprotocol/sdk/-/sdk-0.16.1.tgz` 解包后的 `dist` 内容，确认到以下事实：

- 根入口已导出 `Plan` / `PlanEntry` / `PlanEntryPriority` / `PlanEntryStatus`
- `ClientSideConnection` 已提供稳定 `listSessions`
- terminal kill 类型名已稳定为 `KillTerminalRequest` / `KillTerminalResponse`
- `authenticate` 已存在于 SDK 连接接口
- `session/set_config_option` 已存在于 SDK 连接接口与 schema
- `unstable_closeSession` 仍为 SDK 当前命名
- `PromptRequest.messageId` 与 `PromptResponse.userMessageId` 已存在于 schema
- `dist/schema/zod.gen.js` 中仍包含 `zSessionNotification`
