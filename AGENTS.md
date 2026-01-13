# Mobvibe

An vibe coding WebUI utilizing the [Agent Client Protocol](https://agentclientprotocol.com).

## Basic Architecture

### Backend

Directly connects to and manages ACP sessions, also provide extra info about the local machine for the web frontend to use.

### Frontend

The UI, which is just an AI chat app.

## Tech Stack

### Common

- Biome: faster formatting and linting
  - `biome format --write .`
  - `biome lint --write .`
- Turborepo: monorepo management
- Vite: Why not
- Vitest: Testing with no choice

### Frontend Web UI

- React: The Framework
- Zustand: For State Management
- Tanstack Query: For API Calls
- [Shadcn UI](https://ui.shadcn.com/): The UI component library for everything as much as possible.
  - `pnpm dlx shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=lyra&baseColor=neutral&theme=yellow&iconLibrary=hugeicons&font=jetbrains-mono&menuAccent=subtle&menuColor=default&radius=default&template=vite" --template vite` inits everything.
- [Tailwind CSS](https://tailwindcss.com/): Styling
- [Streamdown](https://github.com/vercel/streamdown): Rendering streamed markdown
- [ACP Typescript SDK](https://agentclientprotocol.github.io/typescript-sdk/): communicate with backend for ACP stuffs

### Backend ACP Adapter and Server

- Express: The Framework
- [ACP Typescript SDK](https://agentclientprotocol.github.io/typescript-sdk/): connect to ACP
- Sqlite3: the simple db
- [Drizzle](https://orm.drizzle.team/docs/get-started-sqlite): the ORM
  - [Better-sqlite3](https://orm.drizzle.team/docs/get-started-sqlite#better-sqlite3): Adapter

## Development Guidelines

- Make sure to run `pnpm format` for formatting
- Always document your code, implementation plan and Architecture
  in `docs` folder in Chinese, before and after implementation.
- Do `git commit` frequently for even minor changes with message in English.
- Stick to types and design of Agent Client Protocol and corresponding SDKs.
- For UI, always use Shadcn UI components whenever possible.
o Mobile UI first, responsive, accessible, and with a focus on performance.
- Always go to <https://agentclientprotocol.github.io/typescript-sdk/> for ACP SDK documentation.

### Useful Commands

- `pnpm dev`: Starts the backend server and frontend dev server.
- `pnpm format`: Formats the code.
- `pnpm lint`: Lints the code.
