# Repository Guidelines

## Project Structure
- `src/` contains the TypeScript source. Key areas include `src/acp/`, `src/daemon/`, `src/auth/`, `src/wal/`, and shared helpers in `src/lib/`.
- `src/**/__tests__/` holds Bun tests (example: `src/acp/__tests__/session-manager.test.ts`).
- `bin/` contains the CLI entry (`bin/mobvibe.mjs`).
- `build.ts` and `build-bin.ts` drive the Bun build pipeline.
- `dist/` and `dist-bin/` are build outputs.

## Build, Test, and Development Commands
- `bun run build.ts` or `pnpm -F @mobvibe/cli build`: build the CLI library output into `dist/`.
- `bun run build-bin.ts` or `pnpm -F @mobvibe/cli build:bin`: build the distributable binary assets.
- `bun dist/index.js` or `pnpm -F @mobvibe/cli start`: run the built CLI.
- `bun test` or `pnpm -F @mobvibe/cli test`: run the test suite.
- `pnpm dev`: runs all packages in the monorepo. Use only when you need the full stack.

## Coding Style & Naming Conventions
- Language: TypeScript (ESM, `"type": "module"`).
- Indentation: tabs, formatted by Biome.
- Use `kebab-case` for filenames (examples: `config-loader.ts`, `wal-store.ts`).
- Format and lint before commits: `pnpm -F @mobvibe/cli format` and `pnpm -F @mobvibe/cli lint`.

## Testing Guidelines
- Framework: Bun test runner.
- Test files live under `src/**/__tests__/` and use `*.test.ts` naming.
- Prefer unit tests near the module they cover (keep new tests in the same feature folder).

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:` with optional scopes (example: `feat(webui): ...`).
- PRs should include a brief summary, tests run, and linked issues. Add screenshots or CLI output only when behavior or UX changes.

## Configuration & Security
- Key environment variables: `MOBVIBE_GATEWAY_URL` (gateway URL), `ANTHROPIC_AUTH_TOKEN` (Claude backend auth).
- Keep secrets out of the repo and avoid logging tokens.
