# Tauri + Better Auth CORS 修复计划

## 背景
- Tauri 生产环境的 WebView `Origin` 常见为 `tauri://localhost` 或 `https://tauri.localhost`。
- 当前 Gateway REST CORS 仅允许 `WEB_URL`，Better Auth 的 `trustedOrigins` 未包含 Tauri origin 与 `mobvibe://`。
- 这会导致 Tauri 应用访问 `/api/auth/*` 时出现 CORS/Origin 校验失败。
- Tauri Dev 使用 `http://localhost:*` 时，`Secure + SameSite=None + Partitioned` 的 cookie 会被 WebView 拒收，导致登录后仍停留在登录页。

## 目标
- REST CORS 放行 Tauri 默认 origin。
- Better Auth `trustedOrigins` 放行 Tauri origin 与 `mobvibe://`。
- Dev 环境放宽 cookie 属性以确保 Tauri Dev 可正常写入会话 cookie。

## 实施步骤
1. 在 `apps/gateway/src/index.ts` 增加 Tauri origin 白名单，并用于 REST CORS 校验。
2. 在 `apps/gateway/src/lib/auth.ts` 将 Tauri origin 与 `mobvibe://` 加入 `trustedOrigins`。
3. 在 `apps/gateway/src/lib/auth.ts` 根据 `NODE_ENV` 调整 cookie 属性，Dev 允许非 Secure/Lax。
4. 更新本文档的实现细节与使用方法。

## 实现细节
- `apps/gateway/src/index.ts` REST CORS 放行：`WEB_URL` + `GATEWAY_CORS_ORIGINS` + `tauri://localhost` + `https://tauri.localhost`。
- `apps/gateway/src/lib/auth.ts` `trustedOrigins` 追加：`tauri://localhost`、`https://tauri.localhost`、`mobvibe://`。
- `apps/gateway/src/lib/auth.ts` Dev 环境设置 `secure: false`、`sameSite: "lax"`、`partitioned: false`，Prod 保持 `secure: true`、`sameSite: "none"`、`partitioned: true`。

## 使用方法
1. 如果 Tauri 运行时的 origin 不是默认值，新增到 `GATEWAY_CORS_ORIGINS` 或在代码中补充。
2. 若 deep-link scheme 修改，必须同步调整 `trustedOrigins` 与 Tauri deep-link 配置。
3. Tauri Dev 登录后确认 `http://localhost:3005` 下的 session cookie 已写入；若未写入，检查是否仍为 Secure/None/Partitioned。
