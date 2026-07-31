# Phase 03 Deferred Items

## 03-01

- **Out-of-scope build blocker:** 根目录 `pnpm build` 在 `apps/webui/src/components/chat/DiffView.tsx` 处失败，原因是当前安装环境无法解析既有依赖 `@pierre/diffs` 与 `@pierre/diffs/react`，并连带触发该文件内既有隐式 `any` 报错。该问题不由 03-01 的 Agent Team create contract/API payload 变更引入；本计划已用 focused WebUI API test 与 `tsc -p apps/webui/tsconfig.json --noEmit` 覆盖本次改动。
