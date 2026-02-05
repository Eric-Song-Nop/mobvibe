# Repository Guidelines

## Project Structure & Module Organization
This is a pnpm + Turborepo monorepo. Top-level code lives in `apps/` (gateway, webui, mobvibe-cli, mobile) and `packages/` (shared types, core utilities), with design docs in `docs/`. The `packages/shared` package is TypeScript types only: source files are in `packages/shared/src` and `packages/shared/src/types`, and build output is in `packages/shared/dist`. Public exports should be surfaced through `packages/shared/src/index.ts`.

## Build, Test, and Development Commands
- `pnpm install` installs workspace dependencies.
- `pnpm dev` starts all services via Turbo. This is usually already running; do not start it unless explicitly requested.
- `pnpm build` builds all packages.
- `pnpm format` formats with Biome.
- `pnpm lint` lints with Biome. Before committing, run `pnpm format && pnpm lint` and fix lint errors.
- `pnpm test:run` runs all tests once with Vitest.
- `pnpm test` runs Vitest in watch mode. Avoid this in agent/CI workflows.

## Coding Style & Naming Conventions
Use TypeScript and keep formatting/linting aligned with Biome. Prefer small, focused type files under `packages/shared/src/types`, and use `kebab-case` for new filenames (example: `agent-config.ts`). Keep exports explicit and stable by updating `packages/shared/src/index.ts` when adding new types.

## Testing Guidelines
The repo uses Vitest, with package-specific tests in `apps/*` or `packages/core`. `packages/shared` typically has no direct tests because it is type-only. When tests are required, run `pnpm test:run` from the repo root and mention any packages that were not tested.

## Commit & Pull Request Guidelines
Use Conventional Commits, such as `feat:`, `fix:`, `chore:`, and optional scopes like `feat(webui): ...`. PRs should include a concise summary, testing notes (or “not run”), and screenshots for UI changes. Link related issues when available.

## Security & Configuration Tips
Gateway configuration relies on env vars like `DATABASE_URL`, `BETTER_AUTH_SECRET`, and OAuth client secrets. Client packages use `VITE_GATEWAY_URL`, `EXPO_PUBLIC_GATEWAY_URL`, or `MOBVIBE_GATEWAY_URL`. Keep secrets out of source control and document any new env vars in the repo root guides.
