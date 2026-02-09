# Mobvibe 代码仓库（Agent 指南）

本指南面向自动化编码代理，重点提供构建/格式化/检查/测试命令与代码风格约束。

## 仓库结构概览

```
mobvibe/
├── apps/
│   ├── gateway/      # Express + Socket.io 网关（端口 3005）
│   ├── webui/        # React 19 + Vite 前端
│   └── mobvibe-cli/  # Bun CLI 守护进程
├── packages/
│   ├── shared/       # 共享 TypeScript 类型
│   └── core/         # 共享 stores/hooks/utils
├── docs/             # 设计/实现文档（中文）
└── biome.json        # 代码格式与 lint 规则
```

说明：当前仓库没有 `apps/mobile/` 目录，以实际目录为准。

## 通用约束

- 使用 `pnpm`，不要使用 `npm`。
- 缩进与格式化交给 Biome；不要手改导入顺序。
- 提交前运行 `pnpm format && pnpm lint`，修复 lint 错误。
- 提交前运行 `pnpm build`，确保整个项目都可以正常构建。

## 根目录常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # Turbo 启动所有包（通常已在跑，除非明确要求否则不要启动）
pnpm build            # 构建所有包
pnpm format           # Biome 格式化
pnpm lint             # Biome 检查（含自动修复）
pnpm test             # Vitest watch（不建议在 agent/CI 场景用）
pnpm test:run         # Vitest 单次运行
```

## 分包命令

gateway（`apps/gateway`）
```bash
pnpm -C apps/gateway dev
pnpm -C apps/gateway build
pnpm -C apps/gateway start
pnpm -C apps/gateway start:migrate
pnpm -C apps/gateway format
pnpm -C apps/gateway lint
pnpm -C apps/gateway test
pnpm -C apps/gateway test:run
pnpm -C apps/gateway db:generate
pnpm -C apps/gateway db:migrate
pnpm -C apps/gateway db:push
pnpm -C apps/gateway db:studio
```

webui（`apps/webui`）
```bash
pnpm -C apps/webui dev
pnpm -C apps/webui build
pnpm -C apps/webui preview
pnpm -C apps/webui format
pnpm -C apps/webui lint
pnpm -C apps/webui test
pnpm -C apps/webui test:run
pnpm -C apps/webui dev:tauri
pnpm -C apps/webui build:tauri
pnpm -C apps/webui android:dev
pnpm -C apps/webui ios:dev
```

mobvibe-cli（`apps/mobvibe-cli`）
```bash
pnpm -C apps/mobvibe-cli build
pnpm -C apps/mobvibe-cli build:bin
pnpm -C apps/mobvibe-cli start
pnpm -C apps/mobvibe-cli format
pnpm -C apps/mobvibe-cli lint
pnpm -C apps/mobvibe-cli test    # Bun test
```

core / shared（`packages/core`, `packages/shared`）
```bash
pnpm -C packages/core build
pnpm -C packages/core dev
pnpm -C packages/core format
pnpm -C packages/core lint
pnpm -C packages/shared build
pnpm -C packages/shared dev
pnpm -C packages/shared format
pnpm -C packages/shared lint
```

## 单个测试的运行方式（重点）

Vitest（gateway/webui/core）
```bash
pnpm -C apps/gateway test:run -- src/socket/__tests__/session-router.test.ts
pnpm -C apps/webui test:run -- src/__tests__/app.test.tsx
pnpm -C apps/webui test:run -- -t "session list"
```

Bun test（mobvibe-cli）
```bash
pnpm -C apps/mobvibe-cli test -- src/acp/__tests__/session-manager.test.ts
```

workspace 过滤运行
```bash
pnpm -F webui test:run -- src/__tests__/app.test.tsx
```

## 代码风格与规范

格式化与缩进
- Biome 为唯一格式化与 lint 依据（`biome.json` 已配置）。
- 缩进使用 tabs，字符串使用双引号。
- 不要手动整理 import 顺序；交给 Biome 的 organizeImports。

导入与模块
- 使用 ESM（所有包均为 `"type": "module"`）。
- 新增公共类型或工具时，更新对应入口（例如 `packages/shared/src/index.ts`）。
- 优先保持导入路径简洁；不要引入未使用依赖。

类型与命名
- 禁止 `any`，未知类型用 `unknown` 并做类型收窄。
- 函数尽量保持 50 行以内，逻辑分层明确。
- 文件名 `kebab-case`；组件/类 `PascalCase`；函数/变量 `camelCase`；Hooks 使用 `useX`。

错误处理
- 不要静默捕获异常；必须记录日志或显式处理。
- 网关/CLI 日志优先使用现有 pino 体系，避免长期使用 `console.log`。

React/UI（webui）
- 组件保持小而清晰；避免过度抽象。
- Tailwind 与现有 UI 结构保持一致，新组件遵循现有目录布局。

数据库与配置（gateway）
- 新增 env 变量需同步文档说明，禁止提交密钥。

## 测试与目录约定

- gateway/core/cli 测试放在 `src/**/__tests__/`，命名 `*.test.ts`。
- webui 测试在 `src/__tests__/` 或 `tests/`，命名 `*.test.ts(x)`。
- 行为变更应补测试或在说明中写清理由。

## 环境变量速览（常用）

- gateway: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MOBVIBE_CORS_ORIGINS`。
- webui: `VITE_GATEWAY_URL`。
- mobvibe-cli: `MOBVIBE_GATEWAY_URL`, `ANTHROPIC_AUTH_TOKEN`。

## 其他说明

- 不要提交 `node_modules/`, `.venv/`, `__pycache__/`, `.DS_Store`。
- 参考文档：`CLAUDE.md` 与 `docs/`。

## Cursor/Copilot 规则

- 未发现 `.cursor/rules/`、`.cursorrules` 或 `.github/copilot-instructions.md`。
