# Tauri GitHub 登录适配

## 目标

- 在 Tauri 环境使用 better-auth-tauri 的 `signInSocial` 启动 GitHub 登录
- Web 环境改为官方用法 `signIn.social({ provider: "github" })`
- 精简 `auth.ts` 中多余的 Tauri 特殊处理
- 仅保留 GitHub provider 并修复登录 loading 状态

## 实现计划

1. 调整 `auth.ts`：移除平台探测、Tauri 平台 header 与 callbackURL 分支
2. 保留 `isInTauri` 与 Tauri HTTP fetch 以确保桌面端 cookie
3. 登录页区分 Tauri 与 Web：Tauri 用 `signInSocial`，Web 用官方 `signIn.social` 形态
4. 移除 `google` provider 类型，并为社交登录添加 `finally` 清理 loading

## 影响范围

- `apps/webui/src/pages/LoginPage.tsx`
- `apps/webui/src/lib/auth.ts`

## 实现细节

- 在登录页根据 `isInTauri()` 判断环境
- Tauri 环境使用 `signInSocial({ authClient, provider: "github" })`
- Web 环境使用 `signIn.social({ provider: "github" })`
- `auth.ts` 移除平台探测与 platform header，仅保留 Tauri HTTP fetch
- `signIn.social` 仅接受 GitHub provider
- 社交登录使用 `finally` 统一清理 loading

## 使用方法

- Tauri 桌面端点击登录页的 GitHub 按钮即可触发 OAuth
- Web 端点击登录页的 GitHub 按钮即可触发 OAuth
