# E2EE 实现文档

## 概述

Mobvibe 实现了**多设备端到端加密（E2EE）**，确保所有 session 事件内容在 CLI 端加密、在任意 WebUI/Tauri 设备端解密，Gateway 仅能看到路由元数据但无法读取内容。

同时，CLI 认证也从 API Key 切换为基于 Ed25519 签名令牌的设备认证，消除了 Gateway 持有可重放凭证的风险。

### 核心特性

- **多设备支持**：每个用户可注册多个设备（CLI、WebUI、Tauri 桌面/移动端）
- **独立密钥**：每个设备拥有独立的 Auth KeyPair（Ed25519）和 Content KeyPair（Curve25519）
- **跨设备解密**：CLI 为用户所有设备包装 DEK，任意设备均可解密 session 内容
- **自动初始化**：WebUI/Tauri 首次登录时自动生成密钥并注册，无需手动配对

### 威胁模型

**防护范围：**

- 被入侵或好奇的 Gateway 读取内容
- 数据库泄露后的内容泄露

**不防护：**

- 被入侵的终端设备（XSS、恶意软件）
- 元数据泄露（session ID、时间戳、事件数量）
- 首次配对时的 MITM（TOFU 限制）

## 密钥体系

每个设备从自己的 32 字节 Master Secret 派生两对密钥：

```
Device Master Secret (32 bytes, 每设备独立)
│
├── KDF(subkey=1, ctx="mobvauth") → seed
│     └── crypto_sign_seed_keypair(seed) → Auth KeyPair (Ed25519)
│           ├── publicKey: 设备身份，注册到 Gateway device_keys.public_key
│           └── secretKey: 签署 Socket 认证令牌
│
└── KDF(subkey=2, ctx="mobvcont") → seed
      └── crypto_box_seed_keypair(seed) → Content KeyPair (Curve25519)
            ├── publicKey: 注册到 device_keys.content_public_key，用于 DEK 包装
            └── secretKey: 解包为该设备包装的 session DEK

Per-Session DEK (每个 session 随机 32 bytes)
├── 包装: crypto_box_seal(dek, eachDeviceContentPubKey)
│         → Record<deviceId, base64WrappedDek> 存储在 acp_sessions.wrapped_dek
└── 使用: crypto_secretbox_easy(payload, randomNonce, dek) → 每个事件
```

**多设备 DEK 包装示例：**

```typescript
// CLI 为所有已知设备包装 DEK
const wrappedDeks: Record<string, string> = {};
for (const device of deviceContentKeys) {
  wrappedDeks[device.deviceId] = wrapDEK(dek, device.contentPublicKey);
}
// 存储为 JSON: { "device-uuid-1": "base64...", "device-uuid-2": "base64..." }
```

**使用的 libsodium 原语：**

| 操作 | 算法 |
|------|------|
| 密钥派生 | `crypto_kdf_derive_from_key` (BLAKE2B) |
| 认证签名 | `crypto_sign_detached` (Ed25519) |
| DEK 包装 | `crypto_box_seal` (X25519 + XSalsa20-Poly1305) |
| 事件加密 | `crypto_secretbox_easy` (XSalsa20-Poly1305) |

## 加密事件格式

所有事件的 payload 字段被替换为加密信封：

```typescript
// 加密前
{ sessionId, machineId, revision, seq, kind, createdAt,
  payload: { update: { sessionUpdate: "agent_message_chunk", ... } } }

// 加密后
{ sessionId, machineId, revision, seq, kind, createdAt,
  payload: { t: "encrypted", c: "<base64(nonce || ciphertext)>" } }
```

元数据（sessionId、machineId、revision、seq、kind、createdAt）保持明文，供 Gateway 路由和确认使用。

## 设备注册与认证流程

### CLI 登录（`mobvibe login`）

```
1. 用户运行 `mobvibe login`
2. CLI 生成 master secret (32 bytes), 派生 Auth KeyPair + Content KeyPair
3. 用户输入 email + password
4. CLI 调用 POST /api/auth/sign-in/email → 获取 session cookie
5. CLI 调用 POST /auth/device/register { publicKey, contentPublicKey, deviceName }
6. CLI 保存 master secret 到 ~/.mobvibe/credentials.json (mode 0600)
7. session cookie 丢弃 — 后续认证使用签名令牌
```

### WebUI/Tauri 自动初始化

```
1. 用户登录（Better Auth session cookie）
2. WebUI 检测 E2EE 未启用
3. 自动调用 e2ee.autoInitialize():
   a. 生成 master secret
   b. 派生 Auth KeyPair + Content KeyPair
   c. 调用 POST /auth/device/register { publicKey, contentPublicKey, deviceName }
   d. 存储 master secret 到 localStorage / Tauri plugin-store
   e. 存储 deviceId 用于 DEK 解包
4. 后续启动时自动从存储加载
```

### CLI Socket 认证

每次连接/重连，CLI 生成一个新的签名令牌：

```typescript
// CLI 端
auth: () => createSignedToken(cryptoService.authKeyPair)

// 令牌结构
{
  payload: { publicKey: "<base64>", timestamp: "<ISO8601>" },
  signature: "<base64 Ed25519 签名>"
}
```

Gateway 中间件验证流程：

```
1. 从 socket.handshake.auth 提取 SignedAuthToken
2. 验证签名有效性 (Ed25519)
3. 检查时间戳新鲜度 (< 5 分钟)
4. 查 device_keys 表获取 userId
5. 认证通过，设置 socket.data = { userId, deviceId }
```

## 代码结构

### 共享加密模块 (`packages/shared/src/crypto/`)

| 文件 | 功能 |
|------|------|
| `types.ts` | `EncryptedPayload`, `CryptoKeyPair`, `SignedAuthToken`, `SodiumLib` 接口 |
| `init.ts` | `initCrypto()` 初始化 libsodium, `getSodium()` 获取实例 |
| `keys.ts` | `generateMasterSecret`, `deriveAuthKeyPair`, `deriveContentKeyPair`, `generateDEK`, `wrapDEK`, `unwrapDEK` |
| `envelope.ts` | `encryptPayload`, `decryptPayload`, `isEncryptedPayload` |
| `auth.ts` | `createSignedToken`, `verifySignedToken` |

所有函数通过 `packages/shared/src/index.ts` 和 `@mobvibe/core` 重新导出。

### Gateway

| 文件 | 变更 |
|------|------|
| `db/schema.ts` | `device_keys` 表新增 `content_public_key` 列, `acpSessions.wrappedDek` 存储 JSON map |
| `routes/device.ts` | `POST /auth/device/register` 接受 `contentPublicKey`, `GET /auth/device/content-keys` 返回用户所有设备密钥 |
| `socket/cli-handlers.ts` | 签名令牌认证中间件（替代 API key） |
| `services/cli-registry.ts` | `CliRecord`: `apiKey` → `deviceId` |
| `services/db-service.ts` | `createAcpSessionDirect` 支持 `wrappedDeks: Record<string, string>` |

### CLI (`apps/mobvibe-cli/`)

| 文件 | 功能 |
|------|------|
| `e2ee/crypto-service.ts` | `CliCryptoService`: 多设备 DEK 管理、事件加密、`wrapDekForAllDevices()` |
| `auth/credentials.ts` | 凭证存储: `masterSecret` (替代 `apiKey`) |
| `auth/login.ts` | 登录流程: 注册 `publicKey` + `contentPublicKey` |
| `daemon/socket-client.ts` | 签名令牌认证 + 启动时获取设备内容密钥列表 |
| `daemon/daemon.ts` | 启动时初始化 crypto, 创建 `CliCryptoService`, 调用 `GET /auth/device/content-keys` |
| `acp/session-manager.ts` | session 创建/加载时生成 DEK 并为所有设备包装 |
| `index.ts` | 和 `mobvibe e2ee status` 命令 |

### WebUI (`apps/webui/`)

| 文件 | 功能 |
|------|------|
| `lib/e2ee.ts` | `E2EEManager`: 自动初始化、设备注册、DEK 解包（支持 deviceId 和 "self" 回退）、事件解密 |
| `hooks/useSocket.ts` | 实时事件 + 回填事件解密, session 变更时解包 DEK |
| `main.tsx` | 启动时 `initCrypto()` + `e2ee.loadFromStorage()` + 自动初始化检测 |
| `components/settings/E2EESettings.tsx` | 配对/取消配对 UI（含自动初始化提示） |
| `pages/SettingsPage.tsx` | 集成 E2EE 设置卡片 |

## 加密边界

CLI 在 **Socket 边界** 进行加密（WAL 本地存储明文）：

```
┌──────────────┐    加密    ┌─────────┐    密文    ┌───────────┐    解密    ┌──────────────┐
│  CLI (明文)  │ ─────────> │  Socket │ ────────> │  Gateway  │ ────────> │  WebUI/Tauri │
│  WAL 存储    │            │  边界   │           │  (看不到   │           │  (明文)      │
└──────────────┘            └─────────┘           │   内容)    │           └──────────────┘
                                                  └───────────┘
```

**三个加密点（`socket-client.ts`）：**

1. **实时事件** — `onSessionEvent` 回调中，emit 前加密
2. **重连重放** — `replayUnackedEvents` 中，emit 前加密
3. **回填 RPC** — `rpc:session:events` 响应中，逐事件加密

**两个解密点（`useSocket.ts`）：**

1. **实时事件** — `handleSessionEventRef` 中 `e2ee.decryptEvent(event)`
2. **回填事件** — `onEvents` 回调中 `e2ee.decryptEvent(rawEvent)`

**DEK 解包点：**

- 初始 session 列表加载（`App.tsx` 中 `syncSessions`）
- `sessions:changed` 事件（`useSocket.ts` 中 `handleSessionsChangedRef`）

## DEK 生命周期（多设备）

```
CLI 启动
  │
  └── 调用 GET /auth/device/content-keys → 获取用户所有设备的 contentPublicKey
        │
        └── cryptoService.setDeviceContentKeys(keys)

Session 创建/加载 (CLI)
  │
  ├── generateDEK() → 随机 32 bytes
  ├── wrapDekForAllDevices(dek):
  │     for (device of deviceContentKeys):
  │       wrappedDeks[device.deviceId] = wrapDEK(dek, device.contentPublicKey)
  │     // 回退：若无其他设备，wrappedDeks["self"] = wrapDEK(dek, ownPubKey)
  ├── 存储到 WAL session 记录 (wrappedDeks)
  ├── 通过 sessions:changed 推送到 Gateway → acp_sessions.wrapped_dek (JSON)
  │
  └── 每个事件: encryptPayload(payload, dek) → { t: "encrypted", c: "..." }

WebUI/Tauri 接收 session
  │
  └── unwrapSessionDeks(sessionId, wrappedDeks):
        1. 尝试 wrappedDeks[ownDeviceId]
        2. 回退尝试 wrappedDeks["self"] (CLI 单设备模式)
        3. 最后尝试所有条目
        → 解包成功则缓存 sessionDeks[sessionId]
```

新 revision = 新 DEK（session reload 时重新生成并重新包装）。

**新增设备后的处理：**

当用户在新设备登录后，CLI 需要重新包装所有 session 的 DEK：

```typescript
// CLI 下次启动时自动执行
const keys = await fetchDeviceContentKeys();
cryptoService.setDeviceContentKeys(keys);
cryptoService.rewrapAllSessions(); // 重新包装所有缓存的 DEK
```

## CLI 命令

```bash
# 显示密钥状态（公钥指纹）
mobvibe e2ee status
```

## 数据库变更

### device_keys 表

```sql
CREATE TABLE device_keys (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  public_key          TEXT NOT NULL UNIQUE,           -- base64 Ed25519 公钥（认证）
  content_public_key  TEXT,                           -- base64 Curve25519 公钥（DEK 包装）
  device_name         TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMP
);
CREATE INDEX device_keys_user_id_idx ON device_keys(user_id);
CREATE INDEX device_keys_public_key_idx ON device_keys(public_key);
```

每个用户可以有多个设备，每个设备有独立的密钥对。

### acp_sessions 变更

`wrapped_dek` 列存储 JSON 格式的多设备包装 DEK map：

```json
{
  "device-uuid-1": "base64_crypto_box_seal_dek_for_device1",
  "device-uuid-2": "base64_crypto_box_seal_dek_for_device2",
  "self": "base64_crypto_box_seal_dek_for_cli_own_key"
}
```

WebUI/Tauri 根据自己的 `deviceId` 查找对应的包装 DEK 进行解包。

## Gateway API 端点

### `POST /auth/device/register`

注册新设备或更新现有设备。

**请求体：**

```json
{
  "publicKey": "base64-ed25519-public-key",
  "contentPublicKey": "base64-curve25519-public-key",
  "deviceName": "My Laptop"
}
```

**响应：**

```json
{ "success": true, "deviceId": "uuid" }
```

- 需要有效的 Better Auth session cookie
- 同一用户重复注册相同 `publicKey` 会返回已有 `deviceId` 并更新 `contentPublicKey`

### `GET /auth/device/content-keys`

获取当前用户所有设备的内容公钥，用于多设备 DEK 包装。

**响应：**

```json
{
  "keys": [
    { "deviceId": "uuid-1", "contentPublicKey": "base64...", "deviceName": "CLI" },
    { "deviceId": "uuid-2", "contentPublicKey": "base64...", "deviceName": "WebUI" }
  ]
}
```

- 只返回已设置 `contentPublicKey` 的设备

## libsodium ESM 兼容性

`libsodium-wrappers` 的 ESM 入口使用相对导入 `./libsodium.mjs`，但 `libsodium` 是独立的 npm 包。解决方案：

- **TypeScript**: 定义 `SodiumLib` 接口避免 CJS/ESM 类型冲突，使用动态 `import()` + cast
- **Vite 生产构建**: 自定义 Rollup 插件 `resolve-libsodium` 将相对路径映射到 `node_modules/libsodium/`
- **Vitest (Gateway)**: 在测试中 mock `@mobvibe/shared` 的 `initCrypto`/`verifySignedToken`

## 未来扩展（不在当前实现中）

- RPC payload 加密（`rpc:message:send` prompt、`rpc:fs:file` content）
- 前向保密（临时 session 密钥）
- Master secret 备份/恢复（云端加密备份）
- Session 标题加密
- 密钥轮换（定期更换 master secret）
- 设备吊销 UI（移除已注册设备，触发 DEK 重新包装）
- 跨用户 session 共享（需要额外的密钥交换协议）
