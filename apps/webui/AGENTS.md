# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React app. Key folders: `src/components/` (UI and feature components), `src/pages/` (route-level screens), `src/hooks/`, `src/lib/` (stores, API, socket integration), `src/i18n/` (locales), and `src/assets/`.
- `public/` holds static assets; Tree-sitter WASM files are copied here on install.
- `src-tauri/` contains the Tauri desktop wrapper and native config.
- Tests live in both `src/__tests__/` and `tests/` with `*.test.ts` / `*.test.tsx` naming.

## Build, Test, and Development Commands
- `pnpm dev` starts the Vite dev server (http://localhost:5173).
- `pnpm build` runs `tsc -b` then creates a production bundle.
- `pnpm preview` serves the production build locally.
- `pnpm format` formats with Biome; `pnpm lint` runs Biome checks.
- `pnpm test` runs Vitest in watch mode; `pnpm test:run` runs once (CI-friendly).
- Optional Tauri: `pnpm dev:tauri`, `pnpm build:tauri`, `pnpm android:dev`, `pnpm ios:dev`.

## Coding Style & Naming Conventions
- TypeScript + React (`.ts`/`.tsx`) with Tailwind for styling.
- Use Biome as the source of truth for formatting; run `pnpm format` before linting.
- Filenames are typically `kebab-case`, component names are `PascalCase`, hooks use `useX`, and store files follow `*-store.ts` (e.g., `chat-store.ts`).

## Testing Guidelines
- Frameworks: Vitest + @testing-library/react with `jsdom`.
- Test files use `*.test.ts(x)` and live in `src/__tests__/` or `tests/`.
- For coverage: `pnpm test --coverage`.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`; optional scopes are used (e.g., `feat(webui): ...`).
- PRs should include a short summary, testing notes (commands run), and screenshots/GIFs for UI changes. Link related issues when applicable.

## Configuration Tips
- `VITE_GATEWAY_URL` overrides the gateway URL; default is `{protocol}://{hostname}:3005`.
