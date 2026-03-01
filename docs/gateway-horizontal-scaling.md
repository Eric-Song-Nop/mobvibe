# Gateway 横向扩展设计

> **状态**: 📋 设计阶段
>
> **目标**: 让 Gateway 具备多实例横向扩展能力

## 1. 问题定义

当前 Gateway 是单进程单实例架构。所有运行时状态存储在进程内存中，无法部署多实例。如果用户数增长超过单实例承载能力，系统无法扩展。

**目标**：在保持现有功能不变的前提下，使 Gateway 支持 N 个实例并行运行，通过增加实例数应对用户增长。

**非目标**：多区域部署、无服务器化改造、客户端协议变更。

## 2. 现有架构分析

### 2.1 数据流

Gateway 的核心角色是**用户隔离的实时中继**：

```
用户 A:   CLI-a1 ──WebSocket──┐                  ┌──WebSocket── WebUI-a1
                               ├── Gateway 实例 ──┤
用户 B:   CLI-b1 ──WebSocket──┘                  └──WebSocket── WebUI-b1
                                       │
                                  PostgreSQL
```

关键特征：**没有任何跨用户通信**。用户 A 的 CLI 事件只会转发给用户 A 的 WebUI，反之亦然。

### 2.2 进程内状态清单

当前阻碍横向扩展的三处进程内状态：

| 状态 | 位置 | 数据结构 | 作用 |
|------|------|----------|------|
| **CliRegistry** | `services/cli-registry.ts` | 3 个 Map：`cliByMachineId`、`cliBySocketId`、`clisByUserId` | CLI 连接路由表。存储每个 CLI 的 Socket 引用、machineId、sessions 列表、backends 等元数据 |
| **pendingRpcs** | `services/session-router.ts` | `Map<requestId, PendingRpc>` | RPC 请求-响应关联。发起 RPC 时创建 Promise，收到 `rpc:response` 时 resolve |
| **sessionSubscriptions** | `socket/webui-handlers.ts` | `Map<sessionId, Map<socketId, userId>>` | WebUI 订阅表。决定 CLI 事件（`session:event`、`permission:request` 等）转发给哪些 WebUI socket |

### 2.3 跨连接通信路径

以下是需要跨 socket 连接通信的所有路径：

**路径 1：REST → CLI（RPC 请求）**

```
WebUI 浏览器 ──HTTP POST /acp/message──→ Gateway
  → SessionRouter.sendMessage()
    → CliRegistry.getCliForSessionByUser(sessionId, userId)  // 查内存
    → cli.socket.emit("rpc:message:send", request)           // 发到 CLI socket
    → pendingRpcs.set(requestId, { resolve, reject })         // 等待响应
```

REST 请求必须到达持有目标 CLI socket 的实例。

**路径 2：CLI → WebUI（事件转发）**

```
CLI daemon ──socket.emit("session:event")──→ Gateway
  → cli-handlers.ts: emitToWebui("session:event", event, userId)
    → webui-handlers.ts: emitToSubscribers(sessionId, event)
      → 遍历 sessionSubscriptions，向每个订阅者 socket 发送事件
```

CLI 事件必须到达持有相关 WebUI subscriber socket 的实例。

**路径 3：CLI → WebUI（状态广播）**

```
CLI daemon ──socket.emit("sessions:changed")──→ Gateway
  → CliRegistry.updateSessionsIncremental()
    → EventEmitter.emit("sessions:changed")
      → webui-handlers.ts: emitToUser(userId, "sessions:changed", payload)
        → 遍历 /webui namespace 所有 socket，找到 userId 匹配的发送
```

**路径 4：RPC 响应（CLI → 发起 RPC 的实例）**

```
CLI daemon ──socket.emit("rpc:response")──→ Gateway
  → SessionRouter.handleRpcResponse()
    → pendingRpcs.get(requestId).resolve(result)  // 必须在发起 RPC 的实例上
```

### 2.4 核心约束

`CliRecord` 持有 `socket: Socket` 引用（`cli-registry.ts:16`）。Socket 是本地进程对象，无法序列化或跨实例传递。这意味着：

- **发送消息到某个 CLI 必须在持有该 CLI socket 的实例上执行**
- **发送消息到某个 WebUI 必须在持有该 WebUI socket 的实例上执行**
- **RPC 的 resolve/reject 必须在发起 RPC 的实例上执行**

## 3. 设计方案：用户亲和性路由

### 3.1 核心思路

利用"无跨用户通信"这一特性：将同一用户的所有连接（CLI WebSocket、WebUI WebSocket、REST 请求）路由到同一个 Gateway 实例。这样所有跨连接通信都发生在进程内，现有代码无需修改。

```
                    ┌──────────────────────┐
                    │    Load Balancer     │
                    │  (按 userId 路由)     │
                    └───┬──────────┬───────┘
                        │          │
           userId=A     │          │  userId=B
                   ┌────▼───┐  ┌──▼─────┐
                   │  GW-1  │  │  GW-2  │
                   │        │  │        │
                   │ CLI-a1 │  │ CLI-b1 │
                   │ CLI-a2 │  │ CLI-b2 │
                   │ WUI-a1 │  │ WUI-b1 │
                   └────┬───┘  └───┬────┘
                        │          │
                   ┌────▼──────────▼────┐
                   │    PostgreSQL      │
                   └────────────────────┘
```

### 3.2 路由机制

需要一个外部存储记录"哪个用户在哪个实例"：

**Redis 作为路由表**：

```
Key: gateway:user:{userId}
Value: { instanceId: "gw-1", updatedAt: 1709251200 }
TTL: 300s (5 分钟，由实例定期续期)
```

路由决策流程：

```
请求到达 Load Balancer
  → 提取 userId（从 session cookie / auth token / WebSocket handshake）
  → 查询 Redis: gateway:user:{userId}
  → 如果存在且实例健康 → 路由到该实例
  → 如果不存在或实例不健康 → 路由到负载最低的实例，写入 Redis
```

### 3.3 连接生命周期

**CLI WebSocket 连接建立**：

```
1. CLI 发起 WebSocket 连接到 Load Balancer
2. Load Balancer 解析 handshake 中的 SignedAuthToken
   → 查 Redis 找到 userId 的目标实例
   → 转发连接到目标实例
3. 目标实例完成 CLI 认证（验证签名、查 DB）
4. 实例更新 Redis 路由表 TTL
```

**WebUI WebSocket 连接建立**：

```
1. WebUI 发起 WebSocket 连接
2. Load Balancer 从 cookie/token 解析 userId
   → 路由到该 userId 的实例
3. 实例完成 Better Auth 会话验证
```

**REST 请求路由**：

```
1. HTTP 请求到达 Load Balancer
2. 从 session cookie / Authorization header 解析 userId
   → 路由到该 userId 的实例
3. 实例处理请求（内存中的 CliRegistry 和 pendingRpcs 都在本地）
```

### 3.4 实例故障与恢复

当一个实例宕机时：

```
1. Redis 中该实例负责的 userId 路由条目在 TTL 过期后自动清除（5 分钟）
2. 或者：健康检查探测到实例不健康，主动清除其所有路由条目
3. 用户的 CLI 和 WebUI 的 Socket.io 客户端自动重连
4. 重连请求到达 Load Balancer，发现无路由条目
   → 分配到最低负载的健康实例
   → 新实例写入 Redis 路由表
5. CLI 重新执行 cli:register，CliRegistry 在新实例上重建
6. WebUI 重新认证并订阅 session
```

影响范围：仅故障实例上的用户会短暂断连（Socket.io 自动重连，通常 1-5 秒）。其他实例上的用户完全不受影响。

### 3.5 实例上下线（弹性伸缩）

**缩容（移除实例）**：

```
1. 将目标实例标记为 draining（不再接受新用户）
2. 等待现有连接的 Redis TTL 过期（5 分钟）
   → 或主动断开连接触发客户端重连到其他实例
3. 确认实例无连接后下线
```

**扩容（添加实例）**：

```
1. 新实例启动，注册到 Load Balancer
2. 后续新用户或重连用户自然分配到新实例（负载最低）
3. 无需迁移现有连接
```

### 3.6 Gateway 代码变更

此方案对 Gateway 应用代码的侵入极小，只需增加两个能力：

**变更 1：实例注册与心跳**

每个 Gateway 实例启动时向 Redis 注册自身，并定期心跳：

```typescript
// 新增文件: services/instance-registry.ts

export class InstanceRegistry {
  private readonly instanceId: string;      // 启动时生成的唯一 ID
  private readonly redis: Redis;
  private heartbeatInterval: NodeJS.Timeout;

  async register(): Promise<void> {
    // SET gateway:instance:{instanceId} { port, startedAt, userCount }
    // EXPIRE 30s
  }

  async heartbeat(): Promise<void> {
    // 续期 TTL，更新 userCount
  }

  async deregister(): Promise<void> {
    // DEL gateway:instance:{instanceId}
    // 清除该实例的所有 user 路由条目
  }
}
```

**变更 2：用户路由条目管理**

在 CLI 连接/断开时维护 Redis 路由表：

```typescript
// 在 cli-handlers.ts 的 connection 事件中

socket.on("cli:register", async (info) => {
  // ...现有逻辑不变...

  // 新增: 更新 Redis 路由
  await redis.set(
    `gateway:user:${userId}`,
    JSON.stringify({ instanceId, updatedAt: Date.now() }),
    "EX", 300
  );
});

socket.on("disconnect", async () => {
  // ...现有逻辑不变...

  // 新增: 如果该用户在本实例上没有其他连接了，清除路由
  if (!hasOtherConnectionsForUser(userId)) {
    await redis.del(`gateway:user:${userId}`);
  }
});
```

**变更 3：定期续期路由条目**

防止 TTL 过期导致误判：

```typescript
// 在 index.ts 中

setInterval(async () => {
  // 遍历本实例上所有活跃用户，续期 Redis TTL
  for (const userId of getActiveUserIds()) {
    await redis.expire(`gateway:user:${userId}`, 300);
  }
  // 续期实例自身心跳
  await instanceRegistry.heartbeat();
}, 60_000); // 每 60 秒
```

### 3.7 Load Balancer 层

Load Balancer 需要实现用户亲和性路由。有两种实现方式：

**方案 A：应用层路由（推荐）**

在 Gateway 前部署一个轻量路由层（可以是 Nginx + Lua、Envoy、或自定义 Node.js 代理）：

```
请求 → 路由层 → 解析 userId → 查 Redis → 转发到目标实例
```

对 WebSocket 连接，路由层在 handshake 阶段决定路由后，后续所有帧直接透传（无额外开销）。

**方案 B：一致性哈希（无需 Redis）**

根据 userId 做一致性哈希（如 ketama），确定性地映射到实例：

```
instanceIndex = consistentHash(userId) % instanceCount
```

优点：无需 Redis 路由表，零延迟路由。
缺点：扩缩容时部分用户会被重新分配（连接中断重建），需要所有节点对实例列表有一致视图。

**推荐方案 A**，因为它在实例故障和扩缩容时的行为更可控。

### 3.8 新增基础设施

| 组件 | 用途 | 规格建议 |
|------|------|----------|
| **Redis** | 路由表 + 实例注册 | 单节点即可，数据量极小（每用户一个 key，每实例一个 key）。Render Redis Starter $10/月 / Upstash 免费计划 / Fly.io Redis |
| **路由层** | 用户亲和性分发 | 轻量 Nginx/Envoy 或内置到 platform 的路由能力 |

Redis 中存储的数据量极小，不需要持久化——所有数据都可以在实例重连时重建。

## 4. 容量估算

### 4.1 单实例容量

当前 Gateway 的资源消耗主要来自：

| 资源 | 消耗来源 | 估算 |
|------|----------|------|
| 内存 | Socket.io 连接（每连接 ~10-50KB）+ CliRegistry 元数据 | 1000 用户 × 3 连接 ≈ 50-150MB |
| CPU | WebSocket 帧编解码 + JSON 序列化 + 事件转发 | 低（I/O 密集，非 CPU 密集） |
| DB 连接 | 连接池上限 10 | CLI 认证和 machine upsert 时使用，非瓶颈 |

保守估计：**单个 512MB 实例可支撑 500-1000 并发用户**。

### 4.2 扩展线性度

用户亲和性方案下，扩展几乎是线性的：

| 实例数 | 预估容量（并发用户） | 月费估算（Render） |
|--------|----------------------|--------------------|
| 1 | 500-1000 | ~$7-25 |
| 2 | 1000-2000 | ~$14-50 |
| 5 | 2500-5000 | ~$35-125 |
| 10 | 5000-10000 | ~$70-250 |

## 5. 方案局限性与后续演进

### 5.1 此方案的已知局限

**局限 1：单用户不可跨实例**

一个用户的所有连接必须在同一实例上。如果某个用户有异常多的 CLI 或 WebUI 连接，可能导致单实例过载。

**对当前产品的影响**：极小。一个用户通常有 1-3 个 CLI（不同开发机）和 1-2 个 WebUI 标签页，远不构成单实例瓶颈。

**局限 2：实例故障影响一批用户**

实例宕机时，该实例上的所有用户同时断连。

**缓解**：Socket.io 客户端有内置自动重连（指数退避），CLI daemon 也有心跳重连逻辑。用户感知到的是 1-5 秒的短暂中断后自动恢复。

**局限 3：路由层增加一跳**

所有请求经过路由层，增加约 1-2ms 延迟。对于实时 WebSocket 消息流，这个延迟可忽略。

### 5.2 后续演进路径（Phase 2，仅在需要时）

如果未来需要突破"单用户不可跨实例"的限制，可以引入 Redis 作为跨实例通信总线：

```
Phase 2 核心变更:
  1. CliRegistry 元数据（不含 Socket 引用）存入 Redis
  2. 跨实例 RPC 通过 Redis pub/sub 转发
  3. 跨实例事件通过 Redis pub/sub 广播
  4. 本地保留 socketId → Socket 映射
```

这本质上是把 CliRegistry 拆成"全局元数据层"（Redis）和"本地连接层"（进程内 Map），实现任意实例都能发起 RPC 和事件转发。但这增加了显著的架构复杂度，建议仅在 Phase 1 不能满足需求时才进入 Phase 2。

## 6. 实施步骤

### Step 1：引入 Redis 连接

在 Gateway 中添加 Redis 客户端，新增 `REDIS_URL` 环境变量。不影响现有功能，不连接 Redis 时以单实例模式运行（向后兼容）。

### Step 2：实现 InstanceRegistry

实现实例注册、心跳、注销逻辑。

### Step 3：实现 UserAffinityManager

在 CLI/WebUI 连接生命周期中维护 `gateway:user:{userId} → instanceId` 映射。

### Step 4：实现路由层

根据部署平台选择路由方案：
- Render：通过 Private Service + 自定义路由实例
- Fly.io：通过 `fly-replay` header（Fly.io 原生支持基于 header 的请求重放到指定实例）
- 自部署：Nginx + Lua 脚本 / Envoy + ext_authz

### Step 5：端到端测试

验证场景：
- 同用户的 CLI 和 WebUI 在同一实例上
- REST 请求路由到正确实例
- 实例故障后用户自动重连到新实例
- 扩缩容时新用户正确分配

### Step 6：部署与灰度

- 先以 2 实例部署验证
- 监控实例间用户分布均匀度
- 确认无功能回归后逐步扩展

## 7. 部署平台适配

### Fly.io（推荐）

Fly.io 原生支持 `fly-replay` header，非常适合用户亲和性路由：

```
请求到达 Fly.io edge → Gateway 实例检查是否为当前实例的用户
  → 是：处理请求
  → 否：返回 fly-replay header，Fly.io 自动重放到正确实例
```

这种方式不需要独立的路由层，Gateway 自身即可完成路由决策。

### Render

Render 的 Private Service 支持多实例，但不直接支持自定义路由。需要：
- 一个独立的路由服务作为 public web service
- Gateway 实例作为 private service

### Kubernetes / Docker Compose

标准做法：Nginx Ingress + Lua 路由 或 Envoy + 外部授权服务。
