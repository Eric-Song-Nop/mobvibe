# 状态管理重构：UI/UX Loading 状态优化

> **状态**: ✅ 已完成 (2025-02)
>
> ## 已完成的修改

### Phase 1: 修复 Capability 检查竞态 ✅

**文件**: `apps/webui/src/hooks/useSessionActivation.ts`

- 移除了手动 `useState` 管理的 `activationState`
- 现在从 TanStack Query mutations 派生 `activationState`
- 点击会话时，如果 capabilities 缺失，会先调用 `discoverSessionsMutation.mutateAsync()` 获取能力再判断
- 添加了 CLI 离线检查和更清晰的错误提示

### Phase 2: 添加 isAttached 状态显示 ✅

**文件**:
- `apps/webui/src/lib/session-utils.ts` (新增)
- `apps/webui/src/components/session/SessionSidebar.tsx`
- `apps/webui/src/components/app/AppSidebar.tsx`

- 新增 `getSessionDisplayStatus()` 函数计算会话显示状态
- SessionListItem 现在显示状态 Badge:
  - `active` (活跃) - 绿色 Badge
  - `loading` (加载中) - 带 Spinner 的 Badge
  - `history` (历史) - 灰色 Badge
  - `error` (错误) - 红色 Badge
  - `detached` (已断开) - 黄色 Badge

### Phase 3: 增强 loadingMessage ✅

**文件**: `apps/webui/src/App.tsx`

- `loadingMessage` 现在完全从 TanStack Query mutations 派生
- 按优先级检查:
  1. `loadSessionMutation.isPending` - "加载会话历史中..."
  2. `reloadSessionMutation.isPending` - "重新加载会话中..."
  3. `discoverSessionsMutation.isPending` - "正在获取 Agent 能力..."
  4. `setSessionModeMutation.isPending` - "切换模式中..."
  5. `setSessionModelMutation.isPending` - "切换模型中..."

### Phase 4: 添加 i18n 文案 ✅

**文件**: `packages/core/src/i18n/locales/zh/translation.json`, `en/translation.json`

新增标签:
- `session.status.active/loading/history/error/detached`
- `session.switchingMode`, `session.switchingModel`
- `cli.discoveringCapabilities`
- `errors.cliOffline`, `errors.capabilityFetchFailed`, `errors.sessionLoadNotSupported`, `errors.missingBackendId`

---

## 原问题概述

当前 WebUI 的状态反馈存在以下问题：

1. **点击会话后反馈模糊** - 用户不知道正在等待什么
2. **Capability 检查竞态** - `session/load` capability 未获取时就报错 "does not support"
3. **`isAttached` 状态不可见** - 用户无法区分"活跃会话"和"历史会话"
4. **状态管理重复** - 同时使用 TanStack Query 和手动 `useState`，导致状态不一致

## 当前状态模型

### 一、Gateway/CLI 连接层

| 状态 | 存储位置 | 来源 | UI 显示 |
|------|----------|------|---------|
| Socket 连接状态 | `gatewaySocket.connected` | socket.io | ❌ 无 |
| SSE 连接状态 | 无 | EventSource | ❌ 无 |
| CLI 在线状态 | `machines-store.connected` | SSE `/machines/stream` | ✅ MachineCard 颜色 |

**缺失**: "连接中"/"重连中"状态

### 二、机器/CLI 层

| 状态 | 存储位置 | 来源 | UI 显示 |
|------|----------|------|---------|
| `machineId` | `machines-store` | SSE | - |
| `hostname` | `machines-store` | SSE | ✅ MachineCard 标题 |
| `connected` | `machines-store` | SSE | ✅ 在线/离线颜色 |
| `sessionCount` | `machines-store` | SSE | ❌ 未显示 |
| `capabilities.load` | `machines-store` | `discoverSessions` API | ❌ 直接判断，不显示 |
| `capabilities.list` | `machines-store` | `discoverSessions` API | ❌ 未显示 |

**缺失**: `capabilities` 获取中的 loading 状态

### 三、会话层

| 状态 | 存储位置 | 来源 | UI 显示 |
|------|----------|------|---------|
| `sessionId` | `chat-store` | API/socket | - |
| `title` | `chat-store` | API/socket | ✅ Session 标题 |
| `cwd` | `chat-store` | API/socket | ✅ 小字路径 |
| `machineId` | `chat-store` | API/socket | - |
| `backendId` | `chat-store` | API/socket | ✅ header 标签 |
| `isAttached` | `chat-store` | socket event | ❌ **未显示** |
| `isLoading` | `chat-store` | 手动设置 | ✅ Badge "loading" |
| `sending` | `chat-store` | 手动设置 | ✅ 输入框禁用 |
| `canceling` | `chat-store` | 手动设置 | ✅ 按钮 "取消中" |
| `error` | `chat-store` | 手动设置 | ✅ 红色错误 |
| `streamError` | `chat-store` | socket event | ✅ header 红色 |
| `detachedReason` | `chat-store` | socket event | ✅ 小字显示 |

### 四、操作层（TanStack Query Mutations）

| 操作 | Mutation | `isPending` | `variables` | UI 反馈 |
|------|----------|-------------|-------------|---------|
| `createSession` | ✅ | ✅ | `{ machineId, cwd, backendId }` | ❌ 仅按钮禁用 |
| `discoverSessions` | ✅ | ✅ | `{ machineId, cwd, backendId? }` | ❌ **无** |
| `loadSession` | ✅ | ✅ | `{ sessionId, cwd, backendId }` | ✅ header message |
| `reloadSession` | ✅ | ✅ | `{ sessionId, cwd, backendId }` | ✅ header message |
| `renameSession` | ✅ | ✅ | `{ sessionId, title }` | ❌ 无 |
| `archiveSession` | ✅ | ✅ | `{ sessionId }` | ❌ 无 |
| `bulkArchiveSessions` | ✅ | ✅ | `{ sessionIds }` | ❌ 无 |
| `setSessionMode` | ✅ | ✅ | `{ sessionId, modeId }` | ❌ 无 |
| `setSessionModel` | ✅ | ✅ | `{ sessionId, modelId }` | ❌ 无 |
| `sendMessage` | ✅ | ✅ | `{ sessionId, prompt }` | ✅ 流式显示 |
| `cancelSession` | ✅ | ✅ | `{ sessionId }` | ✅ canceling 状态 |
| `sendPermissionDecision` | ✅ | ✅ | `{ sessionId, requestId, ... }` | ✅ decisionState |

---

## 用户操作场景与状态流转

### 场景 1: 点击未附加的会话

```
用户点击会话
    │
    ├─→ 检查 CLI 是否在线 (同步)
    │       └─→ 离线: 显示 "CLI 离线，请启动 mobvibe-cli" [END]
    │
    ├─→ 检查 capabilities 是否存在 (同步)
    │       └─→ 不存在: 触发 discoverSessions
    │               │
    │               ├─→ isPending=true → 显示 "正在获取 Agent 能力..."
    │               └─→ 成功/失败 → 继续/报错
    │
    ├─→ 检查 capabilities.load (同步)
    │       └─→ 不支持: 显示 "当前 Agent 不支持加载历史会话" [END]
    │
    └─→ 调用 loadSession
            │
            ├─→ isPending=true → 显示 "加载会话中..."
            │   + setSessionLoading(true)
            │   + clearMessages
            │   + subscribeToSession
            │
            ├─→ 成功 → setActiveSessionId
            │
            └─→ 失败 → restoreMessages + 显示错误
```

**当前问题**: 
- Capability 检查在 `isPending` 设置之前，用户只看到错误
- 没有 "正在获取能力" 的中间状态

### 场景 2: 切换工作区（触发 discovery）

```
用户点击工作区
    │
    └─→ 调用 discoverSessions
            │
            ├─→ isPending=true → 显示 "扫描会话..."
            │
            └─→ 成功 → 更新 sessions + capabilities
```

**当前问题**: 无 loading 反馈

### 场景 3: `isAttached` 状态展示

| `isAttached` | 含义 | 用户能做什么 |
|--------------|------|--------------|
| `true` | 会话正在 CLI/Agent 上运行 | 可以发送消息、实时交互 |
| `false` | 历史会话，未在运行 | 需要先 `session/load` 才能查看/交互 |

**当前问题**: 用户无法区分活跃会话和历史会话

---

## 状态分组与职责

### Group A: 实时状态（Socket/SSE 推送）

| 状态 | 存储位置 | 更新方式 |
|------|----------|----------|
| CLI 在线/离线 | `machines-store` | SSE `machines/stream` |
| 会话列表变化 | `chat-store` | Socket `sessions:changed` |
| 会话附加/分离 | `chat-store` | Socket `session:attached/detached` |
| 消息流 | `chat-store` | Socket `session:event` |

### Group B: API 操作状态（TanStack Query）

| Mutation | 使用字段 | UI 用途 |
|----------|----------|---------|
| `discoverSessionsMutation` | `isPending`, `variables.machineId` | "扫描会话中..." |
| `loadSessionMutation` | `isPending`, `variables.sessionId` | "加载会话中..." |
| `reloadSessionMutation` | `isPending`, `variables.sessionId` | "重新加载中..." |
| `createSessionMutation` | `isPending` | 禁用创建按钮 |
| `archiveSessionMutation` | `isPending`, `variables.sessionId` | "归档中..." |
| `setSessionModeMutation` | `isPending`, `variables.sessionId` | "切换模式中..." |
| `setSessionModelMutation` | `isPending`, `variables.sessionId` | "切换模型中..." |

### Group C: 派生 UI 状态（计算得出）

| 派生状态 | 计算逻辑 | 用途 |
|----------|----------|------|
| `isCurrentSessionLoading` | `loadSessionMutation.isPending && variables.sessionId === activeSessionId` | 当前会话加载指示 |
| `isCurrentMachineDiscovering` | `discoverSessionsMutation.isPending && variables.machineId === selectedMachineId` | 当前机器扫描指示 |
| `hasLoadCapability` | `machines[machineId]?.capabilities?.load` | 判断是否支持加载 |
| `sessionDisplayStatus` | 综合 `isAttached`, `isLoading`, `error` 等 | 会话列表项状态 |

---

## UI 状态映射

### 会话显示状态

```typescript
type SessionDisplayPhase = 
    | "active"      // 活跃: isAttached=true
    | "loading"     // 加载中: mutation pending
    | "history"     // 历史: isAttached=false
    | "error"       // 错误: 有 error
    | "detached";   // 已分离: 有 detachedReason

function getSessionDisplayStatus(
    session: ChatSession, 
    mutations: SessionMutations
): SessionDisplayPhase {
    // 优先级从高到低
    if (session.error) return "error";
    if (session.detachedReason) return "detached";
    
    const isLoading = 
        session.isLoading ||
        (mutations.loadSession.isPending && 
         mutations.loadSession.variables?.sessionId === session.sessionId) ||
        (mutations.reloadSession.isPending && 
         mutations.reloadSession.variables?.sessionId === session.sessionId);
    if (isLoading) return "loading";
    
    if (session.isAttached) return "active";
    return "history";
}
```

### 会话状态显示文案

| Phase | i18n Key | 中文 | 显示位置 |
|-------|----------|------|----------|
| `active` | `session.status.active` | 活跃 | Badge 绿色 |
| `loading` | `session.status.loading` | 加载中 | Badge + Spinner |
| `history` | `session.status.history` | 历史 | Badge 灰色 |
| `error` | `session.status.error` | 错误 | 红色文字 |
| `detached` | `session.status.detached` | 已断开 | 黄色文字 |

### AppHeader loadingMessage 优先级

```typescript
const loadingMessage = useMemo(() => {
    const { loadSessionMutation, reloadSessionMutation, 
            setSessionModeMutation, setSessionModelMutation } = mutations;
    const { discoverSessionsMutation } = sessionsQuery;
    
    // 1. 当前会话加载中
    if (loadSessionMutation.isPending && 
        loadSessionMutation.variables?.sessionId === activeSessionId) {
        return t("session.loadingHistory");
    }
    
    // 2. 当前会话重新加载中
    if (reloadSessionMutation.isPending && 
        reloadSessionMutation.variables?.sessionId === activeSessionId) {
        return t("session.reloadingHistory");
    }
    
    // 3. 当前机器扫描中
    if (discoverSessionsMutation.isPending && 
        discoverSessionsMutation.variables?.machineId === selectedMachineId) {
        return t("cli.discoveringCapabilities");
    }
    
    // 4. 模式切换中
    if (setSessionModeMutation.isPending && 
        setSessionModeMutation.variables?.sessionId === activeSessionId) {
        return t("session.switchingMode");
    }
    
    // 5. 模型切换中
    if (setSessionModelMutation.isPending && 
        setSessionModelMutation.variables?.sessionId === activeSessionId) {
        return t("session.switchingModel");
    }
    
    return undefined;
}, [mutations, sessionsQuery, activeSessionId, selectedMachineId]);
```

### MachineCard 状态显示

```typescript
type MachineDisplayPhase = 
    | "offline"      // 离线
    | "discovering"  // 扫描中
    | "unknown"      // 能力未知
    | "ready";       // 就绪

function getMachineDisplayStatus(
    machine: Machine,
    discoverMutation: DiscoverMutation
): MachineDisplayPhase {
    if (!machine.connected) return "offline";
    
    if (discoverMutation.isPending && 
        discoverMutation.variables?.machineId === machine.machineId) {
        return "discovering";
    }
    
    if (!machine.capabilities) return "unknown";
    return "ready";
}
```

---

## 修复计划

### Phase 1: 修复 Capability 检查竞态

**目标**: 点击会话时，如果 capabilities 缺失，先获取再判断

**文件**: `apps/webui/src/hooks/useSessionActivation.ts`

**修改**:

```typescript
export function useSessionActivation(store: ChatStoreActions) {
    const { loadSessionMutation, reloadSessionMutation } = useSessionMutations(store);
    const { discoverSessionsMutation } = useSessionQueries();
    const machines = useMachinesStore((state) => state.machines);
    const setMachineCapabilities = useMachinesStore((state) => state.setMachineCapabilities);

    const activateSession = useCallback(async (
        session: ChatSession, 
        options?: { force?: boolean }
    ) => {
        const force = options?.force === true;
        
        // 1. 已 attached 且不强制刷新，直接切换
        if (session.isAttached && !force) {
            store.setActiveSessionId(session.sessionId);
            return;
        }

        // 2. 基本检查
        if (session.isLoading) return;
        if (!session.cwd || !session.machineId) return;

        // 3. 检查 CLI 是否在线
        const machine = machines[session.machineId];
        if (!machine?.connected) {
            store.setError(
                session.sessionId, 
                createFallbackError(t("errors.cliOffline"), "connection")
            );
            return;
        }

        // 4. 获取 capabilities（如果缺失）
        let capabilities = machine.capabilities;
        if (!capabilities) {
            try {
                const result = await discoverSessionsMutation.mutateAsync({
                    machineId: session.machineId,
                    cwd: session.cwd,
                });
                capabilities = result.capabilities;
                setMachineCapabilities(session.machineId, capabilities);
            } catch {
                store.setError(
                    session.sessionId,
                    createFallbackError(t("errors.capabilityFetchFailed"), "capability")
                );
                return;
            }
        }

        // 5. 检查 session/load 支持
        if (!capabilities?.load) {
            store.setError(
                session.sessionId,
                createFallbackError(t("errors.sessionLoadNotSupported"), "capability")
            );
            return;
        }

        // 6. 检查 backendId
        if (!session.backendId) {
            store.setError(
                session.sessionId,
                createFallbackError(t("errors.missingBackendId"), "session")
            );
            return;
        }

        // 7. 执行加载
        const params = {
            sessionId: session.sessionId,
            cwd: session.cwd,
            backendId: session.backendId,
            machineId: session.machineId,
        };

        store.setSessionLoading(session.sessionId, true);
        const backup = {
            messages: [...session.messages],
            lastAppliedSeq: session.lastAppliedSeq,
        };
        store.clearSessionMessages(session.sessionId);
        gatewaySocket.subscribeToSession(session.sessionId);

        try {
            const mutation = force ? reloadSessionMutation : loadSessionMutation;
            await mutation.mutateAsync(params);
            store.setActiveSessionId(session.sessionId);
        } catch {
            store.restoreSessionMessages(session.sessionId, backup.messages, {
                lastAppliedSeq: backup.lastAppliedSeq,
            });
            gatewaySocket.unsubscribeFromSession(session.sessionId);
        } finally {
            store.setSessionLoading(session.sessionId, false);
        }
    }, [/* deps */]);

    // 派生状态：从 mutations 计算
    const activationState = useMemo(() => {
        if (loadSessionMutation.isPending) {
            return { phase: "loading", sessionId: loadSessionMutation.variables?.sessionId };
        }
        if (reloadSessionMutation.isPending) {
            return { phase: "reloading", sessionId: reloadSessionMutation.variables?.sessionId };
        }
        if (discoverSessionsMutation.isPending) {
            return { phase: "discovering", machineId: discoverSessionsMutation.variables?.machineId };
        }
        return { phase: "idle" };
    }, [
        loadSessionMutation.isPending,
        loadSessionMutation.variables,
        reloadSessionMutation.isPending,
        reloadSessionMutation.variables,
        discoverSessionsMutation.isPending,
        discoverSessionsMutation.variables,
    ]);

    return {
        activateSession,
        activationState,
        isActivating: activationState.phase !== "idle",
    };
}
```

### Phase 2: 添加 `isAttached` 显示

**文件**: `apps/webui/src/components/session/SessionSidebar.tsx`

**修改 SessionListItem**:

```tsx
const SessionListItem = ({ session, isActive, ... }) => {
    const { t } = useTranslation();
    const mutations = useSessionMutations(/* ... */);
    
    const displayStatus = getSessionDisplayStatus(session, mutations);
    
    return (
        <div className={cn("...", isActive ? "border-primary/40" : "")}>
            <button onClick={handleSelect}>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{session.title}</span>
                    <div className="flex items-center gap-2">
                        {/* 状态 Badge */}
                        {displayStatus === "loading" && (
                            <Badge variant="secondary">
                                <LoadingSpinner className="mr-1 h-3 w-3" />
                                {t("session.status.loading")}
                            </Badge>
                        )}
                        {displayStatus === "active" && (
                            <Badge variant="default" className="bg-green-600">
                                {t("session.status.active")}
                            </Badge>
                        )}
                        {displayStatus === "history" && (
                            <Badge variant="outline" className="text-muted-foreground">
                                {t("session.status.history")}
                            </Badge>
                        )}
                    </div>
                </div>
                {/* ... */}
                {displayStatus === "error" && session.error && (
                    <span className="text-destructive text-xs">
                        {session.error.message}
                    </span>
                )}
            </button>
            {/* ... */}
        </div>
    );
};
```

### Phase 3: 增强 AppHeader loadingMessage

**文件**: `apps/webui/src/App.tsx`

**修改**:

```typescript
const loadingMessage = useMemo(() => {
    // 按优先级检查各 mutation 状态
    if (loadSessionMutation.isPending && 
        loadSessionMutation.variables?.sessionId === activeSessionId) {
        return t("session.loadingHistory");
    }
    
    if (reloadSessionMutation.isPending && 
        reloadSessionMutation.variables?.sessionId === activeSessionId) {
        return t("session.reloadingHistory");
    }
    
    if (discoverSessionsMutation.isPending && 
        discoverSessionsMutation.variables?.machineId === selectedMachineId) {
        return t("cli.discoveringCapabilities");
    }
    
    if (setSessionModeMutation.isPending && 
        setSessionModeMutation.variables?.sessionId === activeSessionId) {
        return t("session.switchingMode");
    }
    
    if (setSessionModelMutation.isPending && 
        setSessionModelMutation.variables?.sessionId === activeSessionId) {
        return t("session.switchingModel");
    }
    
    return undefined;
}, [
    loadSessionMutation.isPending,
    loadSessionMutation.variables,
    reloadSessionMutation.isPending,
    reloadSessionMutation.variables,
    discoverSessionsMutation.isPending,
    discoverSessionsMutation.variables,
    setSessionModeMutation.isPending,
    setSessionModeMutation.variables,
    setSessionModelMutation.isPending,
    setSessionModelMutation.variables,
    activeSessionId,
    selectedMachineId,
]);
```

### Phase 4: 添加 i18n 文案

**文件**: `packages/core/src/i18n/locales/zh-CN.json`

```json
{
  "session": {
    "status": {
      "active": "活跃",
      "loading": "加载中",
      "history": "历史",
      "error": "错误",
      "detached": "已断开"
    },
    "loadingHistory": "加载会话历史中...",
    "reloadingHistory": "重新加载会话中...",
    "switchingMode": "切换模式中...",
    "switchingModel": "切换模型中..."
  },
  "cli": {
    "offline": "CLI 离线",
    "discoveringCapabilities": "正在获取 Agent 能力...",
    "ready": "就绪"
  },
  "errors": {
    "cliOffline": "CLI 离线，请启动 mobvibe-cli",
    "capabilityFetchFailed": "无法获取 Agent 能力",
    "sessionLoadNotSupported": "当前 Agent 不支持加载历史会话",
    "missingBackendId": "会话缺少后端信息"
  }
}
```

### Phase 5: 移除冗余状态

**文件**: `packages/core/src/stores/chat-store.ts`

**考虑移除**:
- `isLoading` - 可用 `loadSessionMutation.isPending` 替代（需评估影响）

**保留**:
- `sending` - 消息发送状态，与流式显示紧密关联
- `canceling` - 取消状态，用户交互反馈
- `isAttached` - 会话属性，非操作状态

---

## 状态最终清单

### 保留的 Store 状态

| Store | 字段 | 原因 |
|-------|------|------|
| `machines-store` | `connected`, `hostname`, `capabilities` | CLI 状态和能力 |
| `chat-store` | `isAttached` | 会话属性，需显示 |
| `chat-store` | `sending`, `canceling` | 用户交互反馈 |
| `chat-store` | `error`, `streamError` | 错误显示 |

### 复用的 Mutation 状态

| Mutation | 使用的字段 | UI 用途 |
|----------|-----------|---------|
| `discoverSessionsMutation` | `isPending`, `variables.machineId` | 扫描中状态 |
| `loadSessionMutation` | `isPending`, `variables.sessionId` | 加载中状态 |
| `reloadSessionMutation` | `isPending`, `variables.sessionId` | 重加载中状态 |
| `setSessionModeMutation` | `isPending`, `variables.sessionId` | 模式切换中 |
| `setSessionModelMutation` | `isPending`, `variables.sessionId` | 模型切换中 |
| `archiveSessionMutation` | `isPending`, `variables.sessionId` | 归档中 |

### 移除的自定义状态

| 当前位置 | 状态 | 替代方案 |
|----------|------|----------|
| `useSessionActivation` | `activationState: ActivationState` | 从 mutation 状态派生 |

---

## 测试计划

### 单元测试

1. **`useSessionActivation`**
   - capabilities 缺失时自动触发 discovery
   - discovery 失败时显示正确错误
   - CLI 离线时显示正确错误
   - 不支持 load 时显示正确错误

2. **`getSessionDisplayStatus`**
   - 各 phase 正确计算
   - 优先级正确

### 集成测试

1. **会话激活流程**
   - 点击历史会话 → 显示 "获取能力" → 显示 "加载中" → 成功
   - 点击历史会话 → CLI 离线 → 显示错误
   - 点击历史会话 → 不支持 load → 显示错误

2. **状态显示**
   - `isAttached=true` 显示 "活跃"
   - `isAttached=false` 显示 "历史"
   - 加载中显示 spinner

### 手动测试

1. 启动 CLI，点击历史会话，观察状态变化
2. 断开 CLI，点击会话，观察错误提示
3. 快速点击多个会话，观察状态追踪是否正确

---

## 相关文件

```
apps/webui/src/
  hooks/
    useSessionActivation.ts      # 主要修改
    useSessionMutations.ts       # mutation 定义
    useSessionQueries.ts         # discoverSessions mutation
  components/
    session/SessionSidebar.tsx   # 添加状态 Badge
    app/AppHeader.tsx            # loadingMessage 逻辑
  App.tsx                        # loadingMessage 派生

packages/core/src/
  stores/chat-store.ts           # 评估移除 isLoading
  i18n/locales/*.json            # 添加文案
```

---

## 时间估计

| Phase | 内容 | 时间 |
|-------|------|------|
| Phase 1 | 修复 capability 检查竞态 | 2-3 小时 |
| Phase 2 | 添加 isAttached 显示 | 1-2 小时 |
| Phase 3 | 增强 AppHeader loadingMessage | 1 小时 |
| Phase 4 | 添加 i18n 文案 | 0.5 小时 |
| Phase 5 | 移除冗余状态              | 1-2 小时 |
| 测试 | 单元测试 + 集成测试 | 2 小时 |
| **总计** | | **7.5-10.5 小时** |
