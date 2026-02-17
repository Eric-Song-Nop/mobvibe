# 状态管理重构：移除持久化状态字段

## 问题概述

当前架构在数据库中持久化了实时状态字段（`machines.isOnline`、`acpSessions.state`），导致"双源真相"问题：
- 数据库中的持久化状态与内存中的实时状态不一致
- Gateway 重启/崩溃后，数据库状态过时
- 初始加载时用户看到错误状态

## 问题详情

### 1. `machines.isOnline` 问题

**根本原因：** 在线状态是实时属性，不应该持久化。

**问题场景：**

| 场景 | DB 状态 | 实际状态 | 影响 |
|------|---------|----------|------|
| Gateway 崩溃重启 | `true` | 所有 CLI 断开 | WebUI 显示所有机器在线 |
| CLI 网络中断 | `true` | 已断开 | 用户看到错误的在线状态 |
| 初始页面加载 | 从 DB 读取 | 依赖 SSE 更新 | 首屏显示错误，SSE 到达后才修正 |

**代码位置：**

```
schema.ts:98              # 定义 isOnline 字段
cli-handlers.ts:122       # 连接时 upsertMachine({ isOnline: true })
cli-handlers.ts:393       # 断开时 updateMachineStatusById(false)
machines.ts:71            # GET /api/machines 从 DB 读取
useMachinesQuery.ts:21    # WebUI 使用 isOnline 作为初始状态
useMachinesStream.ts:32   # SSE 实时更新覆盖初始状态
```

**数据流问题：**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CLI 连接   │────▶│  写入 DB     │────▶│  状态持久化  │
└─────────────┘     │  isOnline=T  │     └─────────────┘
                    └─────────────┘            │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  WebUI 加载  │◀────│ GET /machines│◀────│  读取过时状态 │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼              ┌─────────────┐
│ 用户看到错误状态 │    │ SSE 实时更新 │ (可能延迟数秒)
└────────────────┘    └─────────────┘
```

### 2. `acpSessions.state` 问题

**根本原因：** CLI 断开 ≠ 会话结束，当前逻辑语义错误。

**问题场景：**

| 场景 | 当前行为 | 期望行为 | 影响 |
|------|----------|----------|------|
| CLI 网络中断 | 所有会话设为 `closed` | 会话继续在后台运行 | 用户误以为会话丢失 |
| CLI 重连 | 会话仍在运行但 DB 是 `closed` | 恢复会话状态 | 状态不一致 |
| Gateway 重启 | 所有会话 `active` | 部分已实际结束 | 显示不存在的会话 |

**代码位置：**

```
schema.ts:123             # 定义 state 字段
db-service.ts:156,473,523 # 创建时设 state: "active"
db-service.ts:212,278,307 # 设置 state: "closed"
cli-handlers.ts:394       # CLI 断开时调用 closeSessionsForMachineById()
```

**语义问题：**

```
CLI 断开连接（网络问题）
        │
        ▼
┌─────────────────────────┐
│ closeSessionsForMachine │  ❌ 错误：会话仍在 CLI 进程中运行
│     state = "closed"    │
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ CLI 重连，上报会话列表    │
│ DB 显示 closed          │  ❌ 状态不一致
└─────────────────────────┘
```

### 3. 冗余数据库写入

每次 CLI 连接/断开都写数据库，但 `CliRegistry` 已有准确状态：

```
cli-handlers.ts:116-123   # upsertMachine() 每次连接写 DB
cli-handlers.ts:393       # updateMachineStatusById() 断开写 DB
db-service.ts:101-103     # 更新 isOnline, lastSeenAt, updatedAt
```

这些写入增加了不必要的数据库负载。

## 解决方案

### 核心原则

1. **实时状态只在内存中维护** - `CliRegistry` 是唯一真相来源
2. **数据库只存储历史/元数据** - 如 `lastSeenAt`、`closedAt`
3. **合并数据源** - API 返回 DB 元数据 + 实时状态

### 字段处理方案

| 表 | 字段 | 操作 | 原因 |
|----|------|------|------|
| machines | `isOnline` | **移除** | 实时状态，从 CliRegistry 计算 |
| machines | `lastSeenAt` | 保留 | 历史记录，用于"上次在线"显示 |
| machines | `machineToken` | 保留 | 认证用（虽然当前 API auth 用 deviceKey） |
| acp_sessions | `state` | **移除** | 实时状态，从 CLI 上报判断 |
| acp_sessions | `closedAt` | 保留 | 由 CLI 明确报告结束时设置 |

### 实现计划

#### Phase 1: Schema 迁移

**文件：** `apps/gateway/drizzle/xxxx_remove_state_fields.sql`

```sql
-- 移除 machines.isOnline
ALTER TABLE machines DROP COLUMN is_online;

-- 移除 acp_sessions.state
ALTER TABLE acp_sessions DROP COLUMN state;
```

**文件：** `apps/gateway/src/db/schema.ts`

```typescript
// 移除
isOnline: boolean("is_online").notNull().default(false),

// 移除
state: varchar("state", { length: 50 }).notNull().default("active"),
```

#### Phase 2: 修改 GET /api/machines

**文件：** `apps/gateway/src/routes/machines.ts`

```typescript
// 之前：直接从 DB 读取 isOnline
const userMachines = await db
  .select({
    id: machines.id,
    isOnline: machines.isOnline,  // 移除
    // ...
  })
  .from(machines);

// 之后：合并 DB 数据 + CliRegistry 实时状态
const userMachines = await db
  .select({
    id: machines.id,
    lastSeenAt: machines.lastSeenAt,
    // ...
  })
  .from(machines);

// 合并实时状态
const machinesWithStatus = userMachines.map((m) => {
  const cliRecord = cliRegistry.getCliByMachineIdForUser(m.id, userId);
  return {
    ...m,
    isOnline: cliRecord !== undefined,  // 从内存计算
  };
});
```

#### Phase 3: 移除 CLI 断开时的会话关闭逻辑

**文件：** `apps/gateway/src/socket/cli-handlers.ts`

```typescript
// 移除这行
await closeSessionsForMachineById(record.machineId);

// 只保留机器状态更新（如果 lastSeenAt 保留）
// 或者完全移除 updateMachineStatusById 调用
```

#### Phase 4: 移除废弃的 DB 函数

**文件：** `apps/gateway/src/services/db-service.ts`

```typescript
// 移除
export async function updateMachineStatus(...) { ... }
export async function updateMachineStatusById(...) { ... }
export async function closeAcpSession(...) { ... }
export async function closeSessionsForMachine(...) { ... }
export async function closeSessionsForMachineById(...) { ... }
```

#### Phase 5: 修改 upsertMachine

**文件：** `apps/gateway/src/services/db-service.ts`

```typescript
// 移除 isOnline 参数
export async function upsertMachine(params: {
  rawMachineId: string;
  userId: string;
  name: string;
  hostname: string;
  platform?: string;
  // isOnline 移除
}): Promise<{ machineId: string; userId: string } | null> {
  // ...
  await db.insert(machines).values({
    // ...
    lastSeenAt: new Date(),
    // 不再写 isOnline
  });
}
```

#### Phase 6: 更新调用点

**文件：** `apps/gateway/src/socket/cli-handlers.ts`

```typescript
// 移除 isOnline 参数
const machineResult = await upsertMachine({
  rawMachineId,
  userId,
  name: info.hostname,
  hostname: info.hostname,
  platform: undefined,
  // isOnline: true,  // 移除
});
```

### 数据流改进后

```
┌─────────────┐     ┌─────────────┐
│   CLI 连接   │────▶│ CliRegistry │  ◀── 唯一真相来源
└─────────────┘     │  (内存)     │
                    └─────────────┘
                           │
                           ▼
┌─────────────┐     ┌─────────────┐
│  WebUI 加载  │◀────│GET /machines│
└─────────────┘     │ 合并 DB+内存 │
                    └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ 准确实时状态 │  ✅
                    └─────────────┘
```

## 测试计划

### 单元测试

1. `machines.ts` - 验证合并逻辑正确
2. `db-service.ts` - 验证移除字段后的 CRUD

### 集成测试

1. Gateway 重启后，离线机器显示正确
2. CLI 断开后，会话不被标记为关闭
3. CLI 重连后，会话状态恢复正常

### 手动测试

1. 启动 CLI，检查 WebUI 显示在线
2. 杀掉 CLI 进程，检查 WebUI 显示离线
3. 重启 Gateway，检查状态正确
4. 网络中断 CLI，检查会话不消失

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 迁移期间服务中断 | 中 | 使用蓝绿部署或维护窗口 |
| 前端缓存旧数据 | 低 | SSE 会快速更新 |
| 历史数据丢失语义 | 低 | `closedAt` 仍可判断会话结束 |

## 时间估计

- Phase 1-2 (Schema + API): 2-3 小时
- Phase 3-6 (清理代码): 2-3 小时
- 测试: 2 小时
- **总计: 6-8 小时**

## 相关文件

```
apps/gateway/src/
  db/schema.ts                    # 移除字段
  routes/machines.ts              # 合并实时状态
  services/db-service.ts          # 移除废弃函数
  socket/cli-handlers.ts          # 移除状态写入

apps/gateway/drizzle/
  xxxx_remove_state_fields.sql    # 新迁移

apps/webui/src/
  hooks/useMachinesQuery.ts       # 无需修改（API 响应格式不变）
  hooks/useMachinesStream.ts      # 无需修改
```
