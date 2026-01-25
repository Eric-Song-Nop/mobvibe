# 机器在线状态 SSE 方案

## 目标

- 机器列表初始数据走 HTTP 拉取。
- 在线状态使用 SSE 推送增量更新。
- 机器栏提供“刷新”按钮，手动刷新机器与会话列表。
- 移除 `sessions:list` WebSocket 广播/订阅，HTTP 作为唯一会话列表来源。

## 方案概述（实现前计划）

1. Gateway 增加 `/api/machines/stream` SSE，基于 `cliRegistry.onCliStatus` 推送在线状态。
2. WebUI 新增 `useMachinesStream`，在 App 初始化时订阅 SSE。
3. `useMachinesQuery` 负责机器列表的 HTTP 初始化与刷新。
4. 机器栏左上角新增刷新按钮，触发 machines + sessions 的 HTTP 刷新。
5. 删除 `sessions:list` 的 socket 广播与监听逻辑。

## 实现记录

- Gateway 新增 `GET /api/machines/stream` SSE。
- WebUI 使用 `EventSource` 订阅在线状态，更新 `machines-store`。
- `useMachinesQuery` 负责 HTTP 初始化机器列表。
- 机器栏新增刷新按钮，联动刷新 machines + sessions。
- 移除 `sessions:list` 的网关广播与 WebUI 监听。

## SSE 事件结构

```
{
  "machineId": "...",
  "isOnline": true,
  "hostname": "...",
  "sessionCount": 2
}
```

## 使用说明

- 页面加载：HTTP 拉取机器列表 + SSE 订阅在线状态。
- 点击刷新按钮：同时刷新机器列表与会话列表。

## 2026-01 SSE 跨域修复计划（实现前）

- 检查 gateway 的 CORS 配置是否覆盖 `/api/machines/stream`。
- 补齐 SSE 响应头中的 `Access-Control-Allow-Origin` 与 `Access-Control-Allow-Credentials`。
- 使用 `WEB_URL` 作为 WebUI 来源。
- 更新文档说明 CORS 变量与验证方式。

## 2026-01 SSE 跨域修复记录（实现后）

- Gateway 使用 `WEB_URL` 作为 WebUI 来源。
- `/api/machines/stream` 主动写入 CORS 头，确保 SSE 可携带 Cookie。
- 文档补充 SSE 跨域验证说明。
