# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote-Claude (Mobvibe) is a distributed ACP (Agent Client Protocol) WebUI for local agent workflows. It connects to ACP-compatible CLIs (opencode, gemini-cli, claude-code), manages multi-session chat, and delivers a fast, touch-friendly experience across desktop and mobile.

- ACP Protocol: <https://agentclientprotocol.com/>
- ACP TypeScript SDK: <https://agentclientprotocol.github.io/typescript-sdk/>

## Architecture

The project follows a distributed architecture with three main packages communicating via Socket.io:

```
┌─────────────┐     Socket.io      ┌──────────────┐     Socket.io     ┌───────────────┐
│   webui     │◄──────────────────►│   gateway    │◄─────────────────►│  mobvibe-cli  │
│  (React)    │    /webui ns       │  (Express)   │    /cli ns        │  (Node CLI)   │
└─────────────┘                    └──────────────┘                   └───────┬───────┘
                                          │                                   │
                                     REST API                           stdin/stdout
                                     (:3005)                                  │
                                                                      ┌───────▼───────┐
                                                                      │   ACP CLI     │
                                                                      │ (claude-code) │
                                                                      └───────────────┘
```

### Package Structure

```
remote-claude/
├── apps/
│   ├── webui/           # React frontend with Socket.io client
│   ├── mobvibe-cli/     # CLI daemon with ACP connection
│   ├── gateway/         # Express + Socket.io relay server
│   └── mobile/          # React Native (Expo) mobile app
├── packages/
│   ├── shared/          # Shared TypeScript types
│   └── core/            # Shared stores, hooks, and utilities
└── pnpm-workspace.yaml
```

## Development Commands

### Running the Full Stack

```bash
pnpm dev              # Starts all packages (uses Turbo)
```

### Code Quality

```bash
pnpm format           # Format code with Biome (tab indentation, double quotes)
pnpm lint             # Lint code with Biome
pnpm test             # Run all tests with Vitest
pnpm build            # Build all packages
```

### Per-Package Commands

```bash
# Gateway server (apps/gateway)
cd apps/gateway
pnpm dev              # Watch mode with tsx
pnpm build            # TypeScript compilation
pnpm start            # Run built server

# CLI daemon (apps/mobvibe-cli)
cd apps/mobvibe-cli
pnpm dev              # Watch mode with tsx
pnpm build            # TypeScript compilation
./bin/mobvibe.mjs start --gateway http://localhost:3005

# Web UI (apps/webui)
cd apps/webui
pnpm dev              # Vite dev server
pnpm build            # TypeScript check + Vite build
pnpm test             # Run web tests

# Shared types (packages/shared)
cd packages/shared
pnpm build            # TypeScript compilation
pnpm dev              # Watch mode
```

## Package Details

### packages/shared

Shared TypeScript types used across all packages:

- `types/acp.ts` - ACP protocol types (ContentBlock, SessionNotification, etc.)
- `types/socket-events.ts` - Socket.io event definitions for CLI↔Gateway↔Webui
- `types/errors.ts` - Error types and codes
- `types/session.ts` - Session-related types (SessionSummary, StopReason, etc.)
- `types/fs.ts` - File system types for session file explorer

### apps/gateway

Express + Socket.io relay server (port 3005):

**Socket Namespaces:**
- `/cli` - CLI connections (mobvibe-cli instances)
- `/webui` - Web UI connections (browser clients)

**Core Services:**
- `services/cli-registry.ts` - Track connected CLI instances by machineId
- `services/session-router.ts` - Route requests to appropriate CLI based on session/machine

**Socket Handlers:**
- `socket/cli-handlers.ts` - Handle CLI registration, RPC responses, event forwarding
- `socket/webui-handlers.ts` - Handle session subscriptions, permission decisions

**REST API Routes:**
- `/api/auth/*` - Better Auth endpoints (sign in, sign up, session, OAuth)
- `/machines` - Machine registration and token generation
- `/acp/session` - Session lifecycle (create, close, list)
- `/acp/message` - Message sending
- `/acp/permission/decision` - Permission decisions via REST
- `/fs/session/:sessionId/*` - File system access for sessions
- `/health` - Health check endpoint

### apps/mobvibe-cli

CLI daemon that connects to gateway and manages ACP sessions:

**Core ACP Implementation:**
- `acp/acp-connection.ts` - Generic ACP CLI connection manager (spawns processes, handles stdio)
- `acp/session-manager.ts` - Multi-session orchestrator with permission request routing

**Daemon System:**
- `daemon/daemon.ts` - PID file management, background process, graceful shutdown
- `daemon/socket-client.ts` - Socket.io client to gateway with RPC handlers

**CLI Commands:**
```bash
mobvibe start [--gateway <url>]  # Start daemon (default: http://localhost:3005)
mobvibe stop                      # Stop daemon
mobvibe status                    # Show daemon status
mobvibe logs [-f] [-n <lines>]   # View daemon logs
mobvibe login [--webui <url>]    # Authenticate with gateway
mobvibe logout                   # Clear stored credentials
mobvibe auth-status              # Show authentication status
```

**Configuration:**
- `config.ts` - CLI configuration (gateway URL, machine ID, ACP backends)
- Environment variables:
  - `MOBVIBE_GATEWAY_URL` - Gateway URL (default: http://localhost:3005)
  - `ANTHROPIC_AUTH_TOKEN` - Required for Claude Code backend
  - `ANTHROPIC_BASE_URL` - Optional for Claude Code backend

### apps/mobile

React Native (Expo) mobile app with file-based routing:

**Tech Stack:**
- Expo SDK with Expo Router (file-based routing)
- Uses `packages/core` for shared state and logic
- NativeWind for Tailwind CSS styling

**Screens:**
- `app/(tabs)/index.tsx` - Home/chat screen
- `app/(tabs)/machines.tsx` - Machine management
- `app/(tabs)/settings.tsx` - Settings and preferences
- `app/session/[id].tsx` - Session detail view

**Configuration:**
- `app.config.ts` - Expo configuration
- Environment: `EXPO_PUBLIC_GATEWAY_URL`

### packages/core

Shared logic and state management for webui and mobile:

**Zustand Stores:**
- `stores/chat-store.ts` - Sessions, messages, permissions
- `stores/machines-store.ts` - Connected machines
- `stores/ui-store.ts` - Theme, sidebar, language
- `stores/notification-store.ts` - Toast notifications

**Utilities:**
- `socket/gateway-socket.ts` - GatewaySocket singleton
- `api/client.ts` - API client wrapper
- `hooks/use-socket.ts` - React hook for Socket.io events

**i18n:**
- `i18n/en.json` - English translations
- `i18n/zh.json` - Chinese translations

### apps/webui

React frontend with Socket.io real-time updates:

**State Management:**
- `lib/chat-store.ts` - Zustand store for sessions, messages, permissions
- `lib/ui-store.ts` - UI state (sidebar, theme, language)
- `lib/notification-store.ts` - Toast notifications

**Socket Integration:**
- `lib/socket.ts` - GatewaySocket singleton for Socket.io connection
- `hooks/useSocket.ts` - React hook for session subscriptions and event handling

**API Layer:**
- `lib/api.ts` - TanStack Query wrapper for REST endpoints
- `lib/acp.ts` - ACP types and notification parsing utilities

**Key Components:**
- `components/app/` - Main layout, file explorer, code preview
- `components/chat/` - Message rendering, input, slash commands
- `components/session/` - Session list, metadata, backend selection

## Socket.io Event Types

### CLI ↔ Gateway

```typescript
// CLI → Gateway
interface CliToGatewayEvents {
  'cli:register': { machineId, hostname, version };
  'cli:heartbeat': void;
  'sessions:list': SessionSummary[];
  'session:update': SessionNotification;
  'session:error': StreamErrorPayload;
  'permission:request': PermissionRequestPayload;
  'permission:result': PermissionDecisionPayload;
  'terminal:output': TerminalOutputEvent;
  'rpc:response': RpcResponse<unknown>;
}

// Gateway → CLI
interface GatewayToCliEvents {
  'cli:registered': { machineId };
  'rpc:session:create': RpcRequest<SessionCreateParams>;
  'rpc:session:close': RpcRequest<{ sessionId }>;
  'rpc:session:cancel': RpcRequest<{ sessionId }>;
  'rpc:session:mode': RpcRequest<{ sessionId, modeId }>;
  'rpc:session:model': RpcRequest<{ sessionId, modelId }>;
  'rpc:message:send': RpcRequest<{ sessionId, prompt }>;
  'rpc:permission:decision': RpcRequest<PermissionDecisionPayload>;
  'rpc:fs:roots': RpcRequest<{ sessionId }>;
  'rpc:fs:entries': RpcRequest<{ sessionId, path }>;
  'rpc:fs:file': RpcRequest<{ sessionId, path }>;
  'rpc:fs:resources': RpcRequest<{ sessionId }>;
}
```

### Webui ↔ Gateway

```typescript
// Webui → Gateway
interface WebuiToGatewayEvents {
  'subscribe:session': { sessionId };
  'unsubscribe:session': { sessionId };
  'permission:decision': PermissionDecisionPayload;
}

// Gateway → Webui
interface GatewayToWebuiEvents {
  'session:update': SessionNotification;
  'session:error': StreamErrorPayload;
  'permission:request': PermissionRequestPayload;
  'permission:result': PermissionDecisionPayload;
  'terminal:output': TerminalOutputEvent;
  'cli:status': CliStatusPayload;
  'sessions:list': SessionSummary[];
}
```

## Database (PostgreSQL + Drizzle)

When `DATABASE_URL` is configured, the gateway uses PostgreSQL with Drizzle ORM for persistence.

### Schema Tables

- `users` - User accounts (Better Auth managed)
- `sessions` - Auth sessions (Better Auth managed)
- `accounts` - OAuth provider accounts (Better Auth managed)
- `verifications` - Email verifications (Better Auth managed)
- `machines` - Registered CLI machines (machineId, userId, token, hostname)
- `acpSessions` - ACP session metadata (sessionId, machineId, userId, state)

### Drizzle Commands

```bash
pnpm db:generate   # Generate migration from schema changes
pnpm db:migrate    # Run pending migrations
pnpm db:push       # Push schema directly (dev only)
pnpm db:studio     # Open Drizzle Studio GUI
```

### Environment

- `DATABASE_URL` - PostgreSQL connection string (optional, auth disabled without it)

## Authentication (Better Auth)

When database is configured, Better Auth provides authentication:

### REST Endpoints

All auth endpoints are under `/api/auth/*`:
- `POST /api/auth/sign-in/email` - Email/password sign in
- `POST /api/auth/sign-up/email` - Email registration
- `POST /api/auth/sign-out` - Sign out
- `GET /api/auth/session` - Get current session
- `GET /api/auth/sign-in/social?provider=github` - OAuth redirect

### OAuth Providers

- GitHub (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`)
- Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)

### Session Management

- Sessions stored in PostgreSQL
- HTTP-only cookies for web clients
- Token-based auth for CLI machines

## Development Guidelines

### Code Style

- **Formatter**: Biome with tab indentation and double quotes
- **Imports**: Organize imports enabled (Biome assist)
- **TypeScript**: Strict mode, no implicit any
- **Commit Messages**: English, frequent commits for even minor changes

### ACP Protocol Adherence

- Stick to types and design of Agent Client Protocol and corresponding SDKs
- Always reference <https://agentclientprotocol.github.io/typescript-sdk/> for SDK documentation
- Session lifecycle: `initialize` → `newSession` → `prompt` → `cancel` / close
- Permission workflow: `requestPermission` → user decision → `RequestPermissionResponse`
- Streaming: `sessionUpdate` events with mode/model/message updates

### UI Guidelines

- **Mobile First**: Design for mobile, then enhance for desktop
- **Shadcn UI**: Use Shadcn components whenever possible (Radix primitives + Tailwind)
- **Responsive**: Safe-area padding, dynamic viewport height handling
- **Accessible**: ARIA labels, keyboard navigation, focus management
- **i18n**: Support Chinese and English (use i18next)

### Type Bridging (SDK ↔ Shared)

When passing types between ACP SDK and shared types, use `as unknown as` casts since they are structurally compatible but TypeScript sees them as different:

```typescript
// Example from socket-client.ts
const result = await record.connection.prompt(
  sessionId,
  prompt as unknown as import("@agentclientprotocol/sdk").ContentBlock[],
);
```

## Key Patterns

### Session Management Flow

1. User creates session in webui → REST `POST /acp/session`
2. Gateway routes to CLI via Socket.io RPC → `rpc:session:create`
3. CLI spawns ACP process → handshake → `newSession`
4. CLI sends `session:update` → Gateway relays to subscribed webui clients
5. User sends message → Gateway routes to CLI → `prompt` RPC
6. CLI streams updates → Gateway relays to webui via Socket.io

### Permission Request Flow

1. ACP CLI requests permission → `requestPermission` RPC
2. CLI emits `permission:request` → Gateway relays to webui
3. Webui renders permission card with options
4. User decides → `permission:decision` event or REST endpoint
5. Gateway routes to CLI → CLI resolves promise → returns to ACP

### RPC Pattern (Gateway ↔ CLI)

```typescript
// Gateway sends RPC request
socket.emit('rpc:session:create', { requestId: uuid(), params: { ... } });

// CLI handles and responds
socket.on('rpc:session:create', async (request) => {
  const result = await sessionManager.createSession(request.params);
  socket.emit('rpc:response', { requestId: request.requestId, result });
});
```

## Testing

### Running Tests

```bash
pnpm test                 # Run all tests
pnpm test <pattern>       # Run specific test file
cd apps/webui && pnpm test --watch  # Watch mode
```

### Test Locations

- `apps/webui/src/**/*.test.tsx` - React component and hook tests
- `apps/gateway/src/**/*.test.ts` - Gateway service tests

## Tree-sitter Language Support

The webui uses Tree-sitter for code outline generation. Supported languages:
JavaScript, TypeScript, TSX, Bash, C, C++, C#, Go, Java, PHP, Python, Ruby, Rust

WASM files copied to `apps/webui/public/` via postinstall script.

## Mobile Access

When accessing from phone/tablet on same network:

1. Find your machine's local IP (e.g., 192.168.1.20)
2. Gateway auto-allows private IPs (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
3. Access frontend via `http://192.168.1.20:5173` on mobile device
4. Ensure mobvibe-cli is running and connected to gateway
