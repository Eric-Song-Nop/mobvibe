# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote-Claude (Mobvibe) is a distributed ACP (Agent Client Protocol) WebUI for local agent workflows. It connects to ACP-compatible CLIs (opencode, gemini-cli, claude-code), manages multi-session chat, and delivers a fast, touch-friendly experience across desktop and mobile.

- ACP Protocol: <https://agentclientprotocol.com/>
- ACP TypeScript SDK: <https://agentclientprotocol.github.io/typescript-sdk/>

## Architecture

The project follows a distributed architecture with three main packages communicating via Socket.io. The webui can run as a web app, desktop app (via Tauri), or mobile app (via Tauri mobile):

```
┌─────────────────────────┐     Socket.io      ┌──────────────┐     Socket.io     ┌───────────────┐
│        webui            │◄──────────────────►│   gateway    │◄─────────────────►│  mobvibe-cli  │
│  (React + Tauri v2)     │    /webui ns       │  (Express)   │    /cli ns        │  (Node CLI)   │
│  Web / Desktop / Mobile │                    └──────────────┘                   └───────┬───────┘
└─────────────────────────┘                           │                                   │
                                                 REST API                           stdin/stdout
                                                 (:3005)                                  │
                                                                                  ┌───────▼───────┐
                                                                                  │   ACP CLI     │
                                                                                  │ (claude-code) │
                                                                                  └───────────────┘
```

### Package Structure

```
mobvibe/
├── apps/
│   ├── webui/           # React frontend + Tauri desktop/mobile
│   │   └── src-tauri/   # Tauri Rust backend (desktop/mobile)
│   ├── mobvibe-cli/     # CLI daemon with ACP connection
│   └── gateway/         # Express + Socket.io relay server
├── packages/
│   ├── shared/          # Shared TypeScript types
│   └── core/            # Shared stores, hooks, and utilities
├── docs/                # Implementation plans and design docs (Chinese)
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
pnpm dev              # Vite dev server (web only)
pnpm build            # TypeScript check + Vite build
pnpm test             # Run web tests
pnpm dev:tauri        # Tauri desktop dev mode
pnpm build:tauri      # Tauri desktop build
pnpm android:init     # Initialize Android project
pnpm android:dev      # Run on Android device/emulator
pnpm ios:init         # Initialize iOS project (macOS only)
pnpm ios:dev          # Run on iOS simulator (macOS only)

# Shared types (packages/shared)
cd packages/shared
pnpm build            # TypeScript compilation
pnpm dev              # Watch mode

# Core package (packages/core)
cd packages/core
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

### packages/core

Shared logic and state management for webui and mobile:

**Zustand Stores:**
- `stores/chat-store.ts` - Sessions, messages, permissions, streaming state
- `stores/machines-store.ts` - Connected CLI machines
- `stores/ui-store.ts` - Theme, sidebar, language preferences
- `stores/notification-store.ts` - Toast notifications
- `stores/storage-adapter.ts` - Platform-agnostic storage abstraction

**Socket Integration:**
- `socket/gateway-socket.ts` - GatewaySocket singleton for Socket.io connection

**API Layer:**
- `api/client.ts` - API client wrapper for gateway REST endpoints

**React Hooks:**
- `hooks/use-socket.ts` - React hook for Socket.io session subscriptions

**i18n:**
- `i18n/en.json` - English translations
- `i18n/zh.json` - Chinese translations

### apps/gateway

Express + Socket.io relay server (port 3005):

**Socket Namespaces:**
- `/cli` - CLI connections (mobvibe-cli instances)
- `/webui` - Web UI connections (browser clients)

**Database (Drizzle ORM):**
- `db/schema.ts` - PostgreSQL schema with Better Auth tables + application tables
- `db/index.ts` - Database connection and Drizzle client

**Core Services:**
- `services/cli-registry.ts` - Track connected CLI instances by machineId
- `services/session-router.ts` - Route requests to appropriate CLI based on session/machine
- `services/db-service.ts` - Database operations for machines and sessions

**Socket Handlers:**
- `socket/cli-handlers.ts` - Handle CLI registration, RPC responses, event forwarding
- `socket/webui-handlers.ts` - Handle session subscriptions, permission decisions

**REST API Routes:**
- `routes/sessions.ts` - Session lifecycle (create, close, list, message)
- `routes/machines.ts` - Machine registration and token management
- `routes/fs.ts` - File system access for session working directories
- `routes/health.ts` - Health check endpoint

**Middleware:**
- `middleware/` - Auth and CORS middleware

### apps/mobvibe-cli

CLI daemon that connects to gateway and manages ACP sessions:

**Core ACP Implementation:**
- `acp/acp-connection.ts` - Generic ACP CLI connection manager (spawns processes, handles stdio)
- `acp/session-manager.ts` - Multi-session orchestrator with permission request routing

**Daemon System:**
- `daemon/daemon.ts` - PID file management, background process, graceful shutdown
- `daemon/socket-client.ts` - Socket.io client to gateway with RPC handlers

**Authentication:**
- `auth/` - Machine authentication with gateway

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

### apps/webui

React frontend with Socket.io real-time updates. Supports web, desktop (Windows/macOS/Linux), and mobile (iOS/Android) via Tauri v2.

**Component Structure:**
```
src/components/
├── app/                 # Main application components
│   ├── AppHeader.tsx    # Top navigation bar
│   ├── AppSidebar.tsx   # Session sidebar wrapper
│   ├── ChatFooter.tsx   # Message input area
│   ├── ChatMessageList.tsx
│   ├── CreateSessionDialog.tsx
│   ├── FileExplorerDialog.tsx
│   ├── ColumnFileBrowser.tsx
│   ├── CommandCombobox.tsx    # Slash command picker
│   ├── ResourceCombobox.tsx   # Resource picker
│   ├── WorkingDirectoryDialog.tsx
│   ├── WorkingDirectoryPicker.tsx
│   ├── GatewaySettings.tsx    # Gateway URL settings (Tauri only)
│   └── previews/        # File preview components
├── auth/                # Authentication components
├── chat/                # Message rendering
├── machines/            # Machine management
├── session/             # Session list and metadata
└── ui/                  # Shadcn UI components
```

**Tauri Backend (src-tauri/):**
```
src-tauri/
├── src/
│   ├── main.rs          # Desktop entry point
│   └── lib.rs           # Tauri app setup with plugins
├── Cargo.toml           # Rust dependencies
├── tauri.conf.json      # Tauri configuration
├── capabilities/        # Permission capabilities
└── gen/                 # Generated iOS/Android projects
```

**Tauri Plugins:**
- `tauri-plugin-store` - Persistent key-value storage
- `tauri-plugin-notification` - Native notifications
- `tauri-plugin-deep-link` - OAuth deep link handling (mobvibe:// scheme)
- `tauri-plugin-http` - HTTP requests with cookie support on macOS
- `tauri-plugin-os` - Platform detection

**State Management:**
- Uses `@mobvibe/core` stores via re-exports
- `lib/` contains local utilities and configurations
- `lib/tauri-storage-adapter.ts` - Tauri Store adapter for Zustand persistence

**Socket Integration:**
- Uses `@mobvibe/core/socket` for Socket.io connection
- `hooks/useSocket.ts` - React hook wrapper for session subscriptions

**API Layer:**
- Uses `@mobvibe/core/api` for REST endpoints
- TanStack Query for data fetching and caching

**Key Features:**
- Streamdown for streaming markdown rendering
- Tree-sitter for code outline generation
- Prism for syntax highlighting
- i18next for internationalization
- Native desktop/mobile apps via Tauri v2
- Deep link OAuth with @daveyplate/better-auth-tauri

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

**Better Auth Tables:**
- `users` - User accounts
- `sessions` - Auth sessions
- `accounts` - OAuth provider accounts
- `verifications` - Email verifications

**Application Tables:**
- `machines` - Registered CLI machines (machineId, userId, token, hostname, platform)
- `acpSessions` - ACP session metadata (sessionId, machineId, userId, state, title, cwd)

### Drizzle Commands

```bash
cd apps/gateway
pnpm db:generate   # Generate migration SQL files from schema changes
pnpm db:migrate    # Apply pending migrations to database
pnpm db:push       # Push schema directly (development only, not for production)
pnpm db:studio     # Open Drizzle Studio GUI
```

### Migration Workflow

**Development:**
1. Modify `src/db/schema.ts`
2. Run `pnpm db:generate` to create migration files
3. Review generated SQL in `drizzle/` directory
4. Run `pnpm db:migrate` to apply locally
5. Commit migration files to version control

**Production (Railway):**
- Migrations run automatically at deployment time (not build time)
- The Docker startup script executes `drizzle-kit migrate` before starting the server
- All pending migrations are applied in order
- See `apps/gateway/MIGRATIONS.md` for detailed best practices

**Important:** Always use `drizzle-kit migrate` (versioned migrations) in production, never `drizzle-kit push --force`.

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

## Deployment

### Local Development

```bash
# Start all services
pnpm dev

# Services will be available at:
# - Gateway: http://localhost:3005
# - Web UI: http://localhost:5173
```

### Production Deployment

**Gateway Server:**
```bash
cd apps/gateway
pnpm build
DATABASE_URL="postgresql://..." pnpm start
```

**Web UI:**
```bash
cd apps/webui
pnpm build
# Serve dist/ with your preferred static file server
```

**CLI Daemon:**
```bash
cd apps/mobvibe-cli
pnpm build
./bin/mobvibe.mjs start --gateway https://your-gateway.com
```

**Desktop App (Tauri):**
```bash
cd apps/webui
pnpm build:tauri
# Outputs: src-tauri/target/release/bundle/
# - Windows: .msi, .exe
# - macOS: .app, .dmg
# - Linux: .deb, .AppImage
```

**Mobile App (Tauri):**
```bash
cd apps/webui
# Android (requires Android SDK)
pnpm android:init   # First time only
pnpm android:dev    # Development
# Build: src-tauri/gen/android/ with Android Studio

# iOS (requires Xcode on macOS)
pnpm ios:init       # First time only
pnpm ios:dev        # Development
# Build: src-tauri/gen/apple/ with Xcode
```

### Environment Variables

**Gateway:**
- `DATABASE_URL` - PostgreSQL connection (required for auth)
- `BETTER_AUTH_SECRET` - Secret for session signing
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - GitHub OAuth
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth
- `MOBVIBE_CORS_ORIGINS` - Allowed CORS origins

**Web UI / Desktop / Mobile:**
- `VITE_GATEWAY_URL` - Gateway URL (default: http://localhost:3005)
- For Tauri apps: Gateway URL can also be configured via Settings UI (stored in Tauri Store)

**CLI:**
- `MOBVIBE_GATEWAY_URL` - Gateway URL
- `ANTHROPIC_AUTH_TOKEN` - For Claude Code backend
