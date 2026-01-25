# 开发环境 Cookie-only 认证调整

## 目标

- 开发环境禁用 secure cookie。
- REST 与 Socket 统一使用 Cookie（不再使用 Bearer token）。
- 使用 Better Auth SDK 进行鉴权。

## 方案概述（实现前计划）

1. 使用 `NODE_ENV` 判断开发环境。
2. Gateway 调整 Better Auth cookie 属性（开发 secure=false）。
3. WebUI REST 统一 `credentials: "include"`。
4. WebUI Socket 仅使用 Cookie（移除 token 传参）。
5. SSE 仅依赖 Cookie 会话鉴权。

## 实现记录

- Gateway 根据 `NODE_ENV` 设置 `useSecureCookies` 与 `defaultCookieAttributes.secure`。
- 开启 `partitioned=true` 以符合现代浏览器跨站 Cookie 策略。
- WebUI REST 请求移除 Bearer token，统一 `credentials: "include"`。
- Socket 连接移除 token 注入，仅保留 `withCredentials: true`。
- SSE 端点仅通过 `auth.api.getSession` 校验 Cookie。
- SSE 端点补齐跨域响应头，确保 `EventSource` 能携带 Cookie。

## 验证建议

- WebUI 与 Gateway 跨端口启动，确认 `Set-Cookie` 与请求携带情况。
- 浏览器 Network 面板查看 `GET /api/machines/stream` 是否返回 `Access-Control-Allow-Origin` 与 `Access-Control-Allow-Credentials`。
- 创建 session，确认 `session:update` 与权限事件可正常到达。
