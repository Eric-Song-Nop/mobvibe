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

## 实现状态

| 组件 | 状态 | 说明 |
|------|------|------|
| 共享加密模块 | ✅ 完成 | `packages/shared/src/crypto/` |
| CLI 密钥管理 | ✅ 完成 | `apps/mobvibe-cli/src/e2ee/` |
| CLI 认证流程 | ✅ 完成 | 签名令牌替代 API Key |
| Gateway 设备认证 | ✅ 完成 | `apps/gateway/src/routes/device.ts` |
| Gateway Socket 认证 | ✅ 完成 | `apps/gateway/src/socket/cli-handlers.ts` |
| WebUI 配对/解密 | ✅ 完成 | `apps/webui/src/lib/e2ee.ts` |
| 多设备支持 | ✅ 完成 | WebUI 可配对多个 CLI |
| QR 码配对 | ✅ 完成 | `mobvibe e2ee show` 生成 QR |
| Tauri 存储 | ✅ 完成 | 使用 @tauri-apps/plugin-store |
| 双向加密 | ✅ 完成 | WebUI→CLI 方向也加密 |
| 测试覆盖 | ✅ 完成 | CLI + Gateway + WebUI 加密测试 |

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

**使用的加密原语（tweetnacl + @noble/hashes 纯 JS 实现）：**

| 操作 | 算法 | 实现 |
|------|------|------|
| 密钥派生 | BLAKE2B KDF | `@noble/hashes/blake2b` |
| 认证签名 | Ed25519 | `tweetnacl.sign` |
| DEK 包装 | X25519 + XSalsa20-Poly1305 | `tweetnacl.box` |
| 事件加密 | XSalsa20-Poly1305 | `tweetnacl.secretbox` |

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
// CLI 端 (socket-client.ts)
auth: (cb) => cb(createSignedToken(cryptoService.authKeyPair))

// 令牌结构
{
  payload: { publicKey: "<base64>", timestamp: "<ISO8601>" },
  signature: "<base64 Ed25519 签名>"
}
```

Gateway 中间件验证流程 (`cli-handlers.ts`):

```
1. 从 socket.handshake.auth 提取 SignedAuthToken
2. 验证签名有效性 (Ed25519)
3. 检查时间戳新鲜度 (< 5 分钟)
4. 查 device_keys 表获取 userId
5. 更新 device_keys.lastSeenAt
6. 认证通过，设置 socket.data = { userId, deviceId }
```

### WebUI 配对

```
1. 用户运行 `mobvibe e2ee show` → 获取 master secret (base64) + QR 码
2. WebUI: Settings > End-to-End Encryption > Pair
3. 桌面/浏览器: 粘贴 master secret
   移动端: 扫描 QR 码 (mobvibe://pair?secret=<base64url>)
4. 派生 content keypair → 可解密所有 session
5. 存储: localStorage (浏览器) / Tauri plugin-store (桌面/移动)
```

## 代码结构

### 共享加密模块 (`packages/shared/src/crypto/`)

| 文件 | 功能 |
|------|------|
| `types.ts` | `EncryptedPayload`, `CryptoKeyPair`, `SignedAuthToken` 接口 |
| `init.ts` | `initCrypto()`, `ensureCryptoReady()` — 初始化加密模块 |
| `keys.ts` | `generateMasterSecret`, `deriveAuthKeyPair`, `deriveContentKeyPair`, `generateDEK`, `wrapDEK`, `unwrapDEK` |
| `envelope.ts` | `encryptPayload`, `decryptPayload`, `isEncryptedPayload` |
| `auth.ts` | `createSignedToken`, `verifySignedToken` |

所有函数通过 `packages/shared/src/index.ts` 和 `@mobvibe/core`（通过 `api/types.ts` 的 `export * from "@mobvibe/shared"`）重新导出。

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
| `lib/e2ee.ts` | `E2EEManager`: 多设备配对、DEK 解包、事件解密 |
| `hooks/useSocket.ts` | 实时事件 + 回填事件解密, session 变更时解包 DEK |
| `main.tsx` | 启动时 `initCrypto()` + `e2ee.loadFromStorage()` |
| `components/settings/E2EESettings.tsx` | 多设备配对 UI，设备列表，支持 QR 码扫描 |

## 加密边界

CLI 在 **Socket 边界** 进行加密（WAL 本地存储明文）：

```
                    ┌─────────────────────────────────────────────────────────────────────┐
                    │                           双向加密                                  │
                    │                                                                     │
┌──────────────┐    │   加密   ┌─────────┐    密文    ┌───────────┐    解密   ┌──────────┐
│  CLI (明文)  │ ───┼────────> │  Socket │ ────────> │  Gateway  │ ────────> │  WebUI   │
│  WAL 存储    │    │          │  边界   │           │  (看不到   │           │  (明文)  │
│              │ <──┼──────────│─────────│<──────────│   内容)    │<──────────│          │
└──────────────┘    │   解密   └─────────┘    密文    └───────────┘    加密   └──────────┘
                    │                                                                     │
                    └─────────────────────────────────────────────────────────────────────┘
```

**CLI → WebUI 加密点（`socket-client.ts`）：**

1. **实时事件** — `onSessionEvent` 回调中，emit 前加密 (L1015)
2. **重连重放** — `replayUnackedEvents` 中，emit 前加密 (L1190)
3. **回填 RPC** — `rpc:session:events` 响应中，逐事件加密 (L937)

**WebUI → CLI 加密点：**

1. **`sendMessage`** — `api.ts` 中发送前加密 prompt

**解密点：**

- **WebUI** (`useSocket.ts`)：实时事件 + 回填事件解密
- **CLI** (`socket-client.ts`)：`rpc:message:send` 中解密 prompt

**DEK 解包点：**

- `sessions:changed` 事件（`useSocket.ts` 中 `handleSessionsChangedRef`，L432-438）

## DEK 生命周期

```
Session 创建/加载 (CLI)
  │
  ├── cryptoService.initSessionDek(sessionId) → 随机 32 bytes
  ├── wrapDEK(dek, contentPubKey) → base64 密文
  ├── 存储在内存 Map (sessionDeks, wrappedDekCache)
  ├── 通过 buildSummary() 添加到 SessionSummary.wrappedDek
  ├── sessions:changed → 推送到 Gateway → WebUI
  │
  └── 每个事件: cryptoService.encryptEvent(event) → { t: "encrypted", c: "..." }
```

新 revision = 新 DEK（session reload 时重新生成）。

## CLI 命令

```bash
# 登录并生成密钥
mobvibe login

# 显示 master secret 和 QR 码用于配对
mobvibe e2ee show

# 显示密钥状态（公钥指纹）
mobvibe e2ee status

# 显示认证状态
mobvibe auth-status
```

## 环境变量

| 变量 | 说明 | 用途 |
|------|------|------|
| `MOBVIBE_MASTER_SECRET` | 覆盖 credentials.json 中的 master secret | CI/CD 或临时覆盖 |
| `MOBVIBE_GATEWAY_URL` | Gateway URL | 默认 `https://api.mobvibe.net` |
| `MOBVIBE_HOME` | 自定义 ~/.mobvibe 目录 | 测试或特殊配置 |

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

## 测试覆盖

| 测试文件 | 覆盖内容 |
|----------|----------|
| `apps/mobvibe-cli/src/e2ee/__tests__/crypto-service.test.ts` | DEK 管理、加密/解密、密钥派生、双向加密 |
| `apps/gateway/src/services/__tests__/crypto.test.ts` | 密钥派生、加密/解密、签名验证、DEK 包装 |
| `apps/gateway/src/socket/__tests__/cli-handlers.test.ts` | Socket 认证中间件 |
| `apps/webui/src/__tests__/e2ee.test.ts` | 多设备配对、DEK 解包、存储迁移、双向加密 |

---

## 扩展计划

### Plan A: 多设备支持 ✅ 已完成

**目标：** 允许 WebUI 解密来自多个 CLI 的 session，每个 CLI 有独立的 master secret。

**设计：**

由于 `crypto_box_seal_open` 使用错误密钥时会失败，WebUI 可以遍历所有存储的 master secret 直到解密成功。

```
WebUI 存储多个 master secrets:
  ├── masterSecret-A → contentKeyPair-A
  ├── masterSecret-B → contentKeyPair-B
  └── masterSecret-C → contentKeyPair-C

收到 wrappedDek 后:
  尝试 contentKeyPair-A → 失败
  尝试 contentKeyPair-B → 成功 ✅
  缓存: session-X → masterSecret-B
```

**已完成的改动：**

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| A1 | 重构 `E2EEManager` 支持多个 secrets | `e2ee.ts` | ✅ |
| A2 | 实现 `addPairedSecret(base64Secret)` | `e2ee.ts` | ✅ |
| A3 | 实现 `removePairedSecret(base64Secret)` | `e2ee.ts` | ✅ |
| A4 | 实现 `getPairedSecrets()` 返回设备列表 | `e2ee.ts` | ✅ |
| A5 | 更新 `unwrapSessionDek`：遍历尝试 + 缓存成功的映射 | `e2ee.ts` | ✅ |
| A6 | 更新存储格式为数组 + 迁移旧格式 | `e2ee.ts` | ✅ |
| A7 | 更新 `E2EESettings` UI：显示设备列表、添加/删除 | `E2EESettings.tsx` | ✅ |
| A8 | 添加 i18n 字符串 | `apps/webui/src/i18n/` | ✅ |
| A9 | 添加测试 | `apps/webui/src/__tests__/e2ee.test.ts` | ✅ |

**存储格式：**

```typescript
interface StoredSecret {
  secret: string;       // base64 master secret
  fingerprint: string;  // auth pubkey 前 8 字符，用于显示
  addedAt: number;      // 添加时间戳
}
localStorage.setItem("mobvibe_e2ee_secrets", JSON.stringify(secrets));
```

**核心代码结构：**

```typescript
class E2EEManager {
  private contentKeyPairs: Map<string, CryptoKeyPair> = new Map(); // base64 secret → keypair
  private sessionToSecret: Map<string, string> = new Map();        // sessionId → base64 secret
  private sessionDeks: Map<string, Uint8Array> = new Map();

  async addPairedSecret(base64Secret: string): Promise<void>;
  async removePairedSecret(base64Secret: string): Promise<void>;
  getPairedSecrets(): { fingerprint: string; addedAt: number }[];

  unwrapSessionDek(sessionId: string, wrappedDek: string): boolean {
    // 1. 检查缓存
    const cached = this.sessionToSecret.get(sessionId);
    if (cached) {
      const keypair = this.contentKeyPairs.get(cached);
      if (keypair && this.tryUnwrap(sessionId, wrappedDek, keypair)) return true;
    }

    // 2. 遍历所有 keypair
    for (const [secret, keypair] of this.contentKeyPairs) {
      if (this.tryUnwrap(sessionId, wrappedDek, keypair)) {
        this.sessionToSecret.set(sessionId, secret);
        return true;
      }
    }
    return false;
  }
}
```

---

### Plan B: 双向加密 ✅ 已完成

**目标：** 加密 WebUI → CLI 方向的用户输入，使 Gateway 在双向都只能看到密文。

**核心洞察：** DEK 是对称密钥（`crypto_secretbox`），一旦 WebUI 解包了 wrappedDek，双方就共享同一个 DEK，双向加密自然成立。

```
                    wrappedDek (用 CLI-A 的 content pubkey 加密)
CLI-A ──────────────────────────────────────────────────────────────────► WebUI
  │                                                                       │
  │                        WebUI 尝试解包                                  │
  │                        (遍历 stored secrets)                           │
  │                              │                                         │
  └──────────────────────────────┘                                         │
                                   │                                       │
                             DEK-1 (对称密钥)                               │
                             双方都持有                                     │
         ┌─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CLI-A ◄─────────────────────────────────────────────────► WebUI        │
│                                                                         │
│  CLI → WebUI: encrypt(payload, DEK-1) ─────────► decrypt(..., DEK-1)   │
│  CLI ◄─── decrypt(..., DEK-1) ◄──────────────── encrypt(payload, DEK-1) │
└─────────────────────────────────────────────────────────────────────────┘
```

**已完成的改动：**

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| B1 | `E2EEManager` 添加 `encryptPayloadForSession(sessionId, payload)` | `e2ee.ts` | ✅ |
| B2 | `CliCryptoService` 添加 `getDek(sessionId)` | `crypto-service.ts` | ✅ |
| B3 | `CliCryptoService` 添加 `decryptRpcPayload(encrypted, sessionId)` | `crypto-service.ts` | ✅ |
| B4 | WebUI 发送 `rpc:message:send` 前加密 prompt | `api.ts` | ✅ |
| B5 | CLI 接收 `rpc:message:send` 后解密 prompt | `socket-client.ts` | ✅ |
| B6 | 添加双向加密测试 | 两个测试文件 | ✅ |

**核心代码结构：**

```typescript
// e2ee.ts (WebUI)
class E2EEManager {
  encryptPayloadForSession(sessionId: string, payload: unknown): unknown {
    const dek = this.sessionDeks.get(sessionId);
    if (!dek) return payload; // 无 DEK 则透传
    return encryptPayload(payload, dek);
  }
}

// crypto-service.ts (CLI)
class CliCryptoService {
  getDek(sessionId: string): Uint8Array | null {
    return this.sessionDeks.get(sessionId) ?? null;
  }

  decryptPayload(encrypted: EncryptedPayload, sessionId: string): unknown {
    const dek = this.sessionDeks.get(sessionId);
    if (!dek) throw new Error("No DEK for session");
    return decryptPayload(encrypted, dek);
  }
}

// socket-client.ts (CLI)
private decryptRpcPayload<T>(sessionId: string, data: unknown): T {
  if (!isEncryptedPayload(data)) return data as T;
  const dek = this.options.cryptoService.getDek(sessionId);
  if (!dek) return data as T;
  return decryptPayload(data, dek) as T;
}

// rpc:message:send handler
const prompt = this.decryptRpcPayload(sessionId, request.params.prompt);
```

**边界情况处理：**

| 情况 | 处理 |
|------|------|
| WebUI 未配对 | 透传（不加密） |
| Session DEK 未解包 | 透传（等待 sessions:changed 后重试） |
| CLI 解密失败 | 返回错误，WebUI 显示"解密失败" |

---

### 实施顺序

1. ~~**Plan A** — 多设备支持~~ ✅ 已完成
2. ~~**Plan B** — 双向加密~~ ✅ 已完成

---

## 未来扩展（不在当前计划中）

- 带内配对（通过 Gateway 的临时密钥交换）
- 前向保密（临时 session 密钥）
- Master secret 备份/恢复
- Session 标题加密
- 密钥轮换
- Tauri 钥匙串集成
- 设备吊销 UI
