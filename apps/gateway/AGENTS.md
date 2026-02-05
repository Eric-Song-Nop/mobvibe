# Repository Guidelines

## Project Structure & Module Organization

- `src/index.ts` is the gateway entrypoint (Express + Socket.io).
- `src/routes/`, `src/services/`, `src/socket/`, `src/middleware/`, `src/lib/`, and `src/db/` hold API routes, business logic, socket handlers, middleware, shared utilities, and DB access.
- Tests are colocated under `src/**/__tests__/*.test.ts`.
- `drizzle/` and `drizzle.config.ts` contain schema/migration artifacts; see `MIGRATIONS.md` for notes.
- `dist/` is the TypeScript build output.

## Build, Test, and Development Commands

Run these from `apps/gateway`:

- `pnpm dev`: start the gateway in watch mode (run only when explicitly requested).
- `pnpm build`: compile TypeScript to `dist/`.
- `pnpm start`: run the built server.
- `pnpm start:migrate`: apply migrations then start the server.
- `pnpm test`: Vitest in watch mode.
- `pnpm test:run`: one-shot Vitest run (preferred for CI).
- `pnpm format` and `pnpm lint`: Biome formatting and linting (run both before commits).
- `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:push`, `pnpm db:studio`: Drizzle schema/migration utilities.

## Coding Style & Naming Conventions

- TypeScript (ESM). Indentation is tabs in existing files.
- Use Biome for formatting and linting; avoid manual reformatting.
- Filenames use `kebab-case` (e.g., `session-router.ts`). Classes use `PascalCase`, functions and variables use `camelCase`.

## Testing Guidelines

- Framework: Vitest.
- Test files live in `__tests__` and end with `.test.ts`.
- Add or update tests for behavior changes, especially in `src/services/` and `src/socket/`.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:` with optional scopes (e.g., `feat(gateway): add session router`).
- PRs should include a short summary, testing performed (commands and results), and call out any DB migrations or env var changes. Link related issues when applicable.

## Configuration & Secrets

- Runtime config is via environment variables (e.g., `DATABASE_URL`, `BETTER_AUTH_SECRET`, OAuth client IDs/secrets). Keep secrets out of git and document any new variables in the PR description.
