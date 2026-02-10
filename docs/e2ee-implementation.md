# E2EE 实现文档

## 概述

Mobvibe 实现了端到端加密（E2EE），确保所有 session 事件内容在 CLI 端加密、在 WebUI/Tauri 端解密，Gateway 仅能看到路由元数据但无法读取内容。

同时，CLI 认证也从 API Key 切换为基于 Ed25519 签名令牌的设备认证，消除了 Gateway 持有可重放凭证的风险。

### 威胁模型

**防护范围：**

- 被入侵或好奇的 Gateway 读取内容
- 数据库泄露后的内容泄露

**不防护：**

- 被入侵的终端设备（XSS、恶意软件）
- 元数据泄露（session ID、时间戳、事件数量）
- 首次配对时的 MITM（TOFU 限制）

## 密钥体系

所有密钥从一个 32 字节的 Master Secret 派生：

```
Master Secret (32 bytes, 用户唯一根凭证)
│
├── KDF(subkey=1, ctx="mobvauth") → seed
│     └── crypto_sign_seed_keypair(seed) → Auth KeyPair (Ed25519)
│           ├── publicKey: CLI 身份，注册到 Gateway device_keys 表
│           └── secretKey: 签署认证令牌
│
├── KDF(subkey=2, ctx="mobvcont") → seed
│     └── crypto_box_seed_keypair(seed) → Content KeyPair (Curve25519)
│           ├── publicKey: 包装 session DEK
│           └── secretKey: 解包 session DEK
│
└── Per-Session DEK (每个 session 随机 32 bytes)
      ├── 包装: crypto_box_seal(dek, contentPubKey) → 存储在 Gateway
      └── 使用: crypto_secretbox_easy(payload, randomNonce, dek) → 每个事件
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

## 认证流程

### CLI 登录（`mobvibe login`）

```
1. 用户运行 `mobvibe login`
2. CLI 生成 master secret (32 bytes), 派生 Ed25519 公钥
3. 用户输入 email + password
4. CLI 调用 POST /api/auth/sign-in/email → 获取 session cookie
5. CLI 调用 POST /auth/device/register { publicKey, deviceName }
6. CLI 保存 master secret 到 ~/.mobvibe/credentials.json (mode 0600)
7. session cookie 丢弃 — 后续认证使用签名令牌
8. 显示 master secret (base64) 供 WebUI 配对
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

### WebUI 配对

```
1. 用户运行 `mobvibe e2ee show` → 获取 master secret (base64)
2. WebUI: Settings > End-to-End Encryption > Pair
3. 粘贴 master secret → 派生 content keypair → 可解密所有 session
4. 存储: localStorage (浏览器) / Tauri plugin-store (桌面/移动)
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
| `db/schema.ts` | 新增 `device_keys` 表, `acpSessions` 加 `wrappedDek` 列 |
| `routes/device.ts` | `POST /auth/device/register` 设备注册端点 |
| `socket/cli-handlers.ts` | 签名令牌认证中间件（替代 API key） |
| `services/cli-registry.ts` | `CliRecord`: `apiKey` → `deviceId` |
| `services/db-service.ts` | `findDeviceByPublicKey`, `createAcpSessionDirect` 支持 `wrappedDek` |

### CLI (`apps/mobvibe-cli/`)

| 文件 | 功能 |
|------|------|
| `e2ee/crypto-service.ts` | `CliCryptoService`: DEK 管理、事件加密 |
| `auth/credentials.ts` | 凭证存储: `masterSecret` (替代 `apiKey`) |
| `auth/login.ts` | 新登录流程: email/password + 公钥注册 |
| `daemon/socket-client.ts` | 签名令牌认证 + 3 个加密边界点 |
| `daemon/daemon.ts` | 启动时初始化 crypto, 创建 `CliCryptoService` |
| `acp/session-manager.ts` | session 创建/加载时生成 DEK |
| `index.ts` | `mobvibe e2ee show` 和 `mobvibe e2ee status` 命令 |

### WebUI (`apps/webui/`)

| 文件 | 功能 |
|------|------|
| `lib/e2ee.ts` | `E2EEManager`: 配对、DEK 解包、事件解密 |
| `hooks/useSocket.ts` | 实时事件 + 回填事件解密, session 变更时解包 DEK |
| `main.tsx` | 启动时 `initCrypto()` + `e2ee.loadFromStorage()` |
| `components/settings/E2EESettings.tsx` | 配对/取消配对 UI |
| `pages/SettingsPage.tsx` | 集成 E2EE 设置卡片 |

## 加密边界

CLI 在 **Socket 边界** 进行加密（WAL 本地存储明文）：

```
┌──────────────┐    加密    ┌─────────┐    密文    ┌───────────┐    解密    ┌──────────┐
│  CLI (明文)  │ ─────────> │  Socket │ ────────> │  Gateway  │ ────────> │  WebUI   │
│  WAL 存储    │            │  边界   │           │  (看不到   │           │  (明文)  │
└──────────────┘            └─────────┘           │   内容)    │           └──────────┘
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

## DEK 生命周期

```
Session 创建/加载 (CLI)
  │
  ├── generateDEK() → 随机 32 bytes
  ├── wrapDEK(dek, contentPubKey) → base64 密文
  ├── 存储到 WAL session 记录 (wrappedDek)
  ├── 通过 sessions:changed 推送到 Gateway + WebUI
  │
  └── 每个事件: encryptPayload(payload, dek) → { t: "encrypted", c: "..." }
```

新 revision = 新 DEK（session reload 时重新生成）。

## CLI 命令

```bash
# 显示 master secret 用于配对
mobvibe e2ee show

# 显示密钥状态（公钥指纹）
mobvibe e2ee status
```

## 数据库变更

### device_keys 表

```sql
CREATE TABLE device_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL UNIQUE,  -- base64 Ed25519 公钥
  device_name TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP
);
CREATE INDEX device_keys_user_id_idx ON device_keys(user_id);
CREATE INDEX device_keys_public_key_idx ON device_keys(public_key);
```

### acpSessions 变更

新增 `wrapped_dek TEXT` 列，存储 base64 编码的密封 DEK。

## libsodium ESM 兼容性

`libsodium-wrappers` 的 ESM 入口使用相对导入 `./libsodium.mjs`，但 `libsodium` 是独立的 npm 包。解决方案：

- **TypeScript**: 定义 `SodiumLib` 接口避免 CJS/ESM 类型冲突，使用动态 `import()` + cast
- **Vite 生产构建**: 自定义 Rollup 插件 `resolve-libsodium` 将相对路径映射到 `node_modules/libsodium/`
- **Vitest (Gateway)**: 在测试中 mock `@mobvibe/shared` 的 `initCrypto`/`verifySignedToken`

## 未来扩展（不在当前实现中）

- RPC payload 加密（`rpc:message:send` prompt、`rpc:fs:file` content）
- 带内配对（通过 Gateway 的临时密钥交换）
- 前向保密（临时 session 密钥）
- Master secret 备份/恢复
- Session 标题加密
- 密钥轮换
- Tauri 钥匙串集成
- 设备吊销 UI
