# webui

React-based web interface for remote-claude with real-time Socket.io updates.

## Overview

The webui provides a mobile-first chat interface for interacting with ACP sessions:

- Real-time updates via Socket.io
- End-to-end encryption (E2EE) — pair with CLI master secret to decrypt session content locally
- Multi-session management
- Permission request handling
- File explorer with code preview
- Syntax highlighting and Tree-sitter outlines

```
┌─────────────┐     Socket.io      ┌──────────────┐
│   webui     │◄──────────────────►│   gateway    │
│  (browser)  │    /webui ns       │    :3005     │
└─────────────┘                    └──────────────┘
        │
        └── REST API (/acp/*, /fs/*)
```

## Running

```bash
pnpm dev      # Development server (port 5173)
pnpm build    # Production build
pnpm preview  # Preview production build
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_GATEWAY_URL` | Auto-detected | Gateway server URL |

By default, the gateway URL is auto-detected as `{protocol}://{hostname}:3005`.

## Architecture

### E2EE

- `lib/e2ee.ts` - `E2EEManager` singleton: pairing, DEK unwrapping, event decryption
- `components/settings/E2EESettings.tsx` - Pair/unpair UI in Settings
- `hooks/useSocket.ts` - Decrypts incoming events and backfill events
- `main.tsx` - Initializes crypto and loads stored secret on startup

**Storage:** localStorage (browser) or Tauri plugin-store (desktop/mobile).

### State Management

**Zustand Stores:**

- `lib/chat-store.ts` - Main state for sessions, messages, permissions
  - Session lifecycle and metadata
  - Message history and streaming chunks
  - Permission requests and outcomes
  - Tool call tracking
  - Terminal output buffers

- `lib/ui-store.ts` - UI-only state
  - Sidebar visibility
  - Theme preference
  - Language selection
  - Editing state

- `lib/notification-store.ts` - Toast notifications

### Authentication

In Tauri (desktop/mobile), the webui uses Bearer token authentication. Login responses include a `set-auth-token` header, which is persisted to Tauri Store (`auth.json`). All REST and Socket.io requests include `Authorization: Bearer <token>`. In browser, standard cookie-based authentication is used (`credentials: "include"`).

- `lib/auth.ts` - Auth client setup, `isInTauri()` detection, sign-in/out actions
- `lib/auth-token.ts` - Bearer token cache and Tauri Store persistence (`getAuthToken`, `setAuthToken`, `clearAuthToken`, `loadAuthToken`)

### Socket.io Integration

**`lib/socket.ts`**

- GatewaySocket singleton class
- Connects to `/webui` namespace
- Auto-reconnection handling
- Session subscription management

**`hooks/useSocket.ts`**

- React hook for Socket.io event handling
- Subscribes to ready sessions
- Routes events to store actions:
  - `session:update` → message chunks, mode changes, tool calls
  - `session:error` → error display
  - `permission:request` → permission cards
  - `permission:result` → outcome updates
  - `terminal:output` → terminal buffers

### API Layer

**`lib/api.ts`**

- TanStack Query wrapper for REST endpoints
- Type-safe API functions:
  - `fetchSessions()` - List all sessions
  - `fetchAcpBackends()` - List available backends
  - `createSession()` - Create new session
  - `sendMessage()` - Send prompt to session
  - `fetchFsRoots()` - Get file system roots
  - `fetchFsEntries()` - List directory contents

### Key Components

**App Layout (`components/app/`):**

- `AppHeader` - Status bar, file explorer toggle
- `AppSidebar` - Session list, create button
- `ChatMessageList` - Message display
- `ChatFooter` - Input, mode/model selectors
- `FileExplorerDialog` - Finder-style file browser
- `CreateSessionDialog` - New session form

**Chat Components (`components/chat/`):**

- Message rendering (text, tool calls, permissions)
- Code blocks with syntax highlighting
- Slash command picker (`/`)
- Resource picker (`@`)
- Markdown streaming via Streamdown

**UI Components (`components/ui/`):**

- Shadcn UI components (Radix + Tailwind)
- Button, Dialog, ScrollArea, etc.

### Features

**Session Management:**

- Create sessions with backend and working directory selection
- Switch between active sessions
- Rename and close sessions
- Mode and model switching

**Real-time Updates:**

- Streaming message content
- Tool call progress tracking
- Terminal output display
- Permission request cards

**File Explorer:**

- Finder-style column navigation
- Code preview with syntax highlighting
- Tree-sitter outline for supported languages
- Image preview for common formats

**Mobile Support:**

- Touch-friendly interface
- Safe-area handling
- Responsive layout
- Collapsible sidebar

## Development

```bash
# Development server with hot reload
pnpm dev

# Type checking
pnpm build  # Runs tsc -b first

# Lint and format
pnpm lint
pnpm format

# Run tests
pnpm test
pnpm test --watch  # Watch mode
```

## Testing

Tests are located in `src/**/__tests__/`:

```bash
pnpm test                  # Run all tests
pnpm test --coverage       # With coverage
```

Uses:

- Vitest as test runner
- @testing-library/react for component testing
- jsdom for browser environment

## Tree-sitter Support

Code outline generation supports these languages:

- JavaScript, TypeScript, TSX
- Bash, C, C++, C#
- Go, Java, PHP, Python, Ruby, Rust

WASM files are copied to `public/` via postinstall script.

## Internationalization

Supported languages:

- English (`en`)
- Chinese (`zh`)

Translation files in `src/i18n/locales/`.

## Mobile Access

When accessing from mobile devices on the same network:

1. Find your machine's local IP
2. Gateway auto-allows private IPs
3. Access via `http://{local-ip}:5173`
4. Ensure mobvibe-cli is connected to gateway

## Troubleshooting

### "No backends available"

- Ensure mobvibe-cli is running and connected to gateway
- Check gateway status: `GET /health`
- Verify backends are configured in mobvibe-cli

### "Session not found"

- Session may have been closed
- CLI connection may have dropped
- Try refreshing the page

### "Permission stuck"

- Check CLI logs for errors
- Session may need to be cancelled
- Permission timeout after extended inactivity
