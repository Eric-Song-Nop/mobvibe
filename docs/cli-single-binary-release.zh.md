# CLI 单文件发布方案

## 目标

- 在 release tag（`v*`）时自动构建并发布三平台 CLI 单文件可执行
- NPM 包保持现有发布方式不变（继续用 `bin/mobvibe.mjs` + `dist`）
- GitHub Release 附加单文件产物，便于直接下载运行

## 现状

- `apps/mobvibe-cli/build.ts` 使用 `Bun.build` 并设置 `packages: "external"`，不是单文件
- `bin/mobvibe.mjs` 动态加载 `dist/index.js`，与单文件产物无关
- 发布流程在 `.github/workflows/publish.yml` 中通过 tag 触发，并创建 GitHub Release

## 实施方案

### 1) 新增单文件构建脚本

- 在 `apps/mobvibe-cli/package.json` 增加脚本 `build:bin`
- 新增 `apps/mobvibe-cli/build-bin.ts`，读取环境变量并调用 `bun build --compile`
- 直接从 `src/index.ts` 编译可执行文件
- 产物命名统一为：
  - `mobvibe-linux-x64`
  - `mobvibe-macos-arm64`
  - `mobvibe-windows-x64.exe`

示例命令：

```bash
MOBVIBE_BUN_TARGET=bun-linux-x64 \
MOBVIBE_BIN_OUTFILE=dist-bin/mobvibe-linux-x64 \
pnpm -C apps/mobvibe-cli build:bin
```

### 2) GitHub Actions 发布时构建三平台

- 在 `publish.yml` 增加一个矩阵 job（Linux/macOS/Windows）
- 每个平台执行 `pnpm install` 后运行 `pnpm -C apps/mobvibe-cli build:bin`
- 通过环境变量传入目标参数与产物名
- 使用 `actions/upload-artifact` 上传单文件产物
- release job 下载并附加这些产物到 GitHub Release

### 3) 兼容与限制说明

- 单文件只打包 CLI 本体，仍依赖系统命令：`git`、`tail`、ACP 后端命令（例如 claude-code/opencode）
- 需要在对应平台编译，对应平台运行
- 不改变 NPM 发布行为

## 验证

- 本地验证：执行单文件并运行 `mobvibe status` / `mobvibe start`
- Release 验证：GitHub Release 附件包含三平台产物

## 实施结果

- 新增脚本：`apps/mobvibe-cli/package.json` 添加 `build:bin`
- 新增构建入口：`apps/mobvibe-cli/build-bin.ts`
- 发布流程：`.github/workflows/publish.yml` 增加 `cli-bin` 矩阵任务，并在 release 中附加三平台产物

## 影响范围

- 新增脚本：`apps/mobvibe-cli/package.json`
- CI/CD：`.github/workflows/publish.yml`
- 文档：`docs/cli-single-binary-release.zh.md`
