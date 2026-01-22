# Mobvibe (Remote-Claude)

A distributed ACP (Agent Client Protocol) WebUI for local agent workflows.

## Architecture

```
┌─────────────┐     Socket.io      ┌──────────────┐     Socket.io     ┌───────────────┐
│   webui     │◄──────────────────►│   gateway    │◄─────────────────►│  mobvibe-cli  │
│  (React)    │                    │  (Express)   │                   │  (Node CLI)   │
└─────────────┘                    └──────────────┘                   └───────┬───────┘
                                                                              │
                                                                        stdin/stdout
                                                                              │
                                                                      ┌───────▼───────┐
                                                                      │   ACP CLI     │
                                                                      │ (claude-code) │
                                                                      └───────────────┘
```

### Package Structure

- **packages/shared**: Shared TypeScript types for Socket.io events and ACP
- **apps/gateway**: Express + Socket.io relay server (port 3005)
- **apps/mobvibe-cli**: CLI daemon that connects to gateway and manages ACP sessions
- **apps/webui**: React frontend with Socket.io real-time updates

### Data Flow

1. **webui** connects to **gateway** via Socket.io `/webui` namespace
2. **mobvibe-cli** connects to **gateway** via Socket.io `/cli` namespace
3. **gateway** routes REST API calls and Socket.io events between webui and CLI
4. **mobvibe-cli** spawns and manages ACP CLI processes (claude-code, etc.)

## Tech Stack

### Common

- **Biome**: Formatting and linting (`pnpm format`, `pnpm lint`)
- **Turborepo**: Monorepo management and parallel builds
- **Vite**: Build tool for webui
- **Vitest**: Testing framework
- **Socket.io**: Real-time bidirectional communication

### packages/shared

- TypeScript types shared across all packages
- ACP protocol types, Socket.io event definitions, error types

### apps/gateway

- **Express**: HTTP server framework
- **Socket.io**: WebSocket server with namespaces
- Routes REST API requests to CLI via Socket.io RPC

### apps/mobvibe-cli

- **Commander.js**: CLI framework
- **Socket.io-client**: WebSocket client to gateway
- **@agentclientprotocol/sdk**: ACP protocol implementation

### apps/webui

- **React**: UI framework
- **Zustand**: State management
- **TanStack Query**: API calls and caching
- **Shadcn UI**: Component library (Radix + Tailwind)
- **Socket.io-client**: Real-time updates from gateway
- **Streamdown**: Markdown rendering for streamed content
- **Tree-sitter**: Code outline generation

## Development Commands

```bash
pnpm dev              # Start all packages (gateway, mobvibe-cli, webui)
pnpm build            # Build all packages
pnpm format           # Format code with Biome
pnpm lint             # Lint code with Biome
pnpm test             # Run all tests
```

### Running Individually

```bash
# Gateway (port 3005)
cd apps/gateway && pnpm dev

# CLI daemon
cd apps/mobvibe-cli && ./bin/mobvibe.mjs start --gateway http://localhost:3005

# Web UI (port 5173)
cd apps/webui && pnpm dev
```

## Development Guidelines

- Run `pnpm format` before committing
- Document implementation plans in `docs/` folder in Chinese
- Commit frequently with English messages
- Follow ACP protocol types and patterns from SDK documentation
- Use Shadcn UI components for all UI elements
- Mobile-first, responsive, accessible design
- Reference ACP SDK docs: <https://agentclientprotocol.github.io/typescript-sdk/>
