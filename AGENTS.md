# Mobvibe (Remote-Claude)

A distributed ACP (Agent Client Protocol) WebUI for local agent workflows. Connect to ACP-compatible CLIs (claude-code, opencode, gemini-cli), manage multi-session chat, and enjoy a fast, touch-friendly experience across desktop and mobile.

## Architecture

```
┌─────────────┐     Socket.io      ┌──────────────┐     Socket.io     ┌───────────────┐
│   webui     │◄──────────────────►│   gateway    │◄─────────────────►│  mobvibe-cli  │
│  (React)    │    /webui ns       │  (Express)   │    /cli ns        │  (Node CLI)   │
└─────────────┘                    └──────────────┘                   └───────┬───────┘
       ▲                                  │                                   │
       │                             REST API                           stdin/stdout
       │                             (:3005)                                  │
┌──────┴──────┐                                                       ┌───────▼───────┐
│   mobile    │                                                       │   ACP CLI     │
│   (Expo)    │◄─────────────────────────────►                        │ (claude-code) │
└─────────────┘                                                       └───────────────┘
```

## Package Structure

```
mobvibe/
├── apps/
│   ├── gateway/         # Express + Socket.io relay server (port 3005)
│   ├── webui/           # React frontend with Vite
│   ├── mobvibe-cli/     # CLI daemon with ACP SDK
│   └── mobile/          # React Native (Expo) mobile app
├── packages/
│   ├── shared/          # Shared TypeScript types
│   └── core/            # Shared stores, hooks, and utilities
└── docs/                # Implementation plans (Chinese)
```

## Tech Stack

| Package | Key Technologies |
|---------|-----------------|
| **gateway** | Express, Socket.io, Drizzle ORM, Better Auth, PostgreSQL |
| **webui** | React 19, Vite, Zustand, TanStack Query, Shadcn UI, Tailwind, Tree-sitter |
| **mobvibe-cli** | Commander.js, @agentclientprotocol/sdk, Socket.io-client |
| **mobile** | Expo SDK 53, Expo Router, React Native Paper, React Navigation |
| **core** | Zustand, Socket.io-client, i18next |
| **shared** | TypeScript types only |
| **Monorepo** | pnpm workspaces, Turborepo, Biome, Vitest |

## Quick Start

```bash
# Install dependencies
pnpm install

# Start all services (gateway, webui, mobvibe-cli)
pnpm dev # we are always running dev, don't run it unless explicitly requested to.

# Services:
# - Gateway: http://localhost:3005
# - Web UI: http://localhost:5173

# Start CLI daemon manually (if not using pnpm dev)
cd apps/mobvibe-cli
./bin/mobvibe.mjs start --gateway http://localhost:3005
```

## Development Commands

```bash
pnpm dev              # Start all packages (Turbo) we are always running dev, don't run it unless explicitly requested to.
pnpm build            # Build all packages
pnpm format           # Format code with Biome
pnpm lint             # Lint code with Biome
pnpm test             # Run all tests with Vitest
```

## Database Setup (Optional)

When `DATABASE_URL` is set, the gateway uses PostgreSQL for auth and persistence:

```bash
cd apps/gateway
export DATABASE_URL="postgresql://user:pass@localhost:5432/mobvibe"
pnpm db:push          # Push schema to database
pnpm db:migrate       # Migrate database schema
pnpm db:studio        # Open Drizzle Studio
```

## CLI Usage

```bash
mobvibe start [--gateway <url>]  # Start daemon
mobvibe stop                      # Stop daemon
mobvibe status                    # Show status
mobvibe logs [-f] [-n <lines>]   # View logs
mobvibe login [--webui <url>]    # Authenticate
mobvibe logout                   # Clear credentials
```

## Environment Variables

| Variable | Package | Description |
|----------|---------|-------------|
| `DATABASE_URL` | gateway | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | gateway | Session signing secret |
| `GITHUB_CLIENT_ID/SECRET` | gateway | GitHub OAuth |
| `GOOGLE_CLIENT_ID/SECRET` | gateway | Google OAuth |
| `MOBVIBE_CORS_ORIGINS` | gateway | Allowed CORS origins |
| `VITE_GATEWAY_URL` | webui | Gateway URL |
| `EXPO_PUBLIC_GATEWAY_URL` | mobile | Gateway URL |
| `MOBVIBE_GATEWAY_URL` | cli | Gateway URL |
| `ANTHROPIC_AUTH_TOKEN` | cli | Claude Code backend token |

## Data Flow

1. **webui/mobile** → Socket.io `/webui` namespace → **gateway**
2. **gateway** → Socket.io `/cli` namespace → **mobvibe-cli**
3. **mobvibe-cli** → stdin/stdout → **ACP CLI** (claude-code, opencode, etc.)

### Session Flow

1. User creates session → REST `POST /acp/session` → Gateway
2. Gateway → Socket.io RPC → CLI spawns ACP process
3. CLI streams `session:update` → Gateway relays to webui
4. User sends message → Gateway routes to CLI → Response streams back

### Permission Flow

1. ACP CLI requests permission → CLI emits `permission:request`
2. Gateway relays to webui → User approves/denies
3. Decision routed back to CLI → CLI resolves permission

## Key Features

- **Multi-session**: Run multiple ACP sessions concurrently
- **Real-time streaming**: Socket.io-based message streaming
- **Permission UI**: Approve/deny tool calls from the browser
- **File explorer**: Browse session working directory
- **Code preview**: Syntax highlighting with Tree-sitter outlines
- **Mobile-first**: Touch-friendly UI with safe-area handling
- **i18n**: English and Chinese support
- **Authentication**: Optional Better Auth with OAuth providers

## Documentation

- `CLAUDE.md` - Detailed development guide for AI assistants
- `docs/` - Implementation plans and design documents (Chinese)

## Links

- ACP Protocol: <https://agentclientprotocol.com/>
- ACP TypeScript SDK: <https://agentclientprotocol.github.io/typescript-sdk/>
