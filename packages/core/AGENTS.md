# Repository Guidelines

## Project Structure & Module Organization
- Monorepo root: `mobvibe/` with apps and shared packages. This guide applies to `packages/core`.
- Core source: `packages/core/src/` (TypeScript ESM). Key modules: `api/`, `hooks/`, `i18n/`, `socket/`, `stores/`, `utils/`.
- Tests: colocated under `src/**/__tests__/` (e.g., `src/hooks/__tests__/use-socket.test.tsx`).
- Build output: `packages/core/dist/` (generated JS + `.d.ts`).

## Build, Test, and Development Commands
- `pnpm -C packages/core build`: compile with `tsc` to `dist/`.
- `pnpm -C packages/core dev`: watch mode TypeScript build.
- `pnpm -C packages/core format`: run Biome formatter.
- `pnpm -C packages/core lint`: run Biome checks (auto-fixes enabled).
- From repo root: `pnpm test:run` runs Vitest once for the whole monorepo. Avoid `pnpm dev` unless explicitly requested (it starts all services).

## Coding Style & Naming Conventions
- TypeScript, ES modules, double quotes, tabs for indentation (enforced by Biome).
- File naming is kebab-case (e.g., `use-session-backfill.ts`).
- React hooks follow `use-*.ts/tsx` naming; tests use `*.test.ts/tsx` inside `__tests__`.
- Prefer small, focused modules; export via `src/index.ts` and feature entrypoints (e.g., `src/hooks/index.ts`).

## Testing Guidelines
- Framework: Vitest (configured at repo level).
- Place tests alongside code in `__tests__` folders; keep test names aligned with filenames.
- Run targeted tests via `pnpm -C packages/core test` only if a script is added; otherwise use root `pnpm test:run`.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `chore:` with optional scopes (e.g., `feat(webui): ...`).
- PRs should include: concise description, testing notes (commands run), and screenshots for UI-facing changes.
- Before commit: run `pnpm format && pnpm lint` at the repo root and fix lint errors.

## Configuration Notes
- Core depends on `@mobvibe/shared`, `zustand`, `socket.io-client`, and `i18next`.
- Peer deps include `react` and `@tanstack/react-query`—avoid adding runtime imports that assume specific versions.
