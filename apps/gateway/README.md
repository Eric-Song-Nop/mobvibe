# Gateway

Express + Socket.io relay server that bridges the webui and mobvibe-cli.

## Overview

The gateway acts as a central hub:
- Receives REST API requests from the webui
- Routes them to the appropriate CLI instance via Socket.io RPC
- Relays real-time events (session updates, permissions, terminal output) back to webui

```
┌─────────────┐     Socket.io      ┌──────────────┐     Socket.io     ┌───────────────┐
│   webui     │◄──────────────────►│   gateway    │◄─────────────────►│  mobvibe-cli  │
│             │    /webui ns       │    :3005     │    /cli ns        │               │
└─────────────┘                    └──────────────┘                   └───────────────┘
                                          │
                                     REST API
                                   /acp, /fs, /health
```

## Running

```bash
pnpm dev      # Development with hot reload (tsx watch)
pnpm build    # Build TypeScript
pnpm start    # Run production build
```

Default port: **3005**

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_PORT` | `3005` | Server port |
| `GATEWAY_CORS_ORIGINS` | (empty) | Additional CORS origins (comma-separated) |
| `DATABASE_URL` | (empty) | PostgreSQL connection string for auth (optional) |
| `BETTER_AUTH_SECRET` | (auto) | Secret for session signing (optional) |

Private IPs (10.x.x.x, 192.168.x.x, 172.16-31.x.x) and localhost are always allowed.

## REST API Endpoints

### Authentication (when DATABASE_URL is set)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/reference` | OpenAPI reference page (interactive) |
| `GET` | `/api/auth/open-api/generate-schema` | OpenAPI schema JSON |
| `POST` | `/api/auth/sign-in/email` | Email/password sign in |
| `POST` | `/api/auth/sign-up/email` | Email registration |
| `POST` | `/api/auth/sign-out` | Sign out |
| `GET` | `/api/auth/session` | Get current session |
| `GET` | `/api/auth/sign-in/social?provider=<provider>` | OAuth redirect |

### Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/acp/sessions` | List all sessions |
| `POST` | `/acp/session` | Create new session |
| `POST` | `/acp/session/close` | Close a session |
| `POST` | `/acp/session/cancel` | Cancel running operation |
| `POST` | `/acp/session/mode` | Change session mode |
| `POST` | `/acp/session/model` | Change session model |

### Messaging

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/acp/message` | Send message to session |
| `POST` | `/acp/message/id` | Generate message ID |
| `POST` | `/acp/permission/decision` | Submit permission decision |

### File System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/fs/session/:sessionId/roots` | Get file system roots |
| `GET` | `/fs/session/:sessionId/entries` | List directory entries |
| `GET` | `/fs/session/:sessionId/file` | Get file content |
| `GET` | `/fs/session/:sessionId/resources` | List all resources |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/backends` | List available backends |

## Socket.io Namespaces

### `/cli` - CLI Connections

Events from CLI:
- `cli:register` - Register CLI instance with machineId
- `cli:heartbeat` - Keep-alive ping
- `sessions:list` - Report current sessions
- `session:update` - Session state changes
- `session:error` - Error events
- `permission:request` - Permission requests
- `permission:result` - Permission outcomes
- `terminal:output` - Terminal output chunks
- `rpc:response` - RPC call responses

Events to CLI (RPC):
- `rpc:session:create` - Create session
- `rpc:session:close` - Close session
- `rpc:session:cancel` - Cancel session
- `rpc:session:mode` - Change mode
- `rpc:session:model` - Change model
- `rpc:message:send` - Send message
- `rpc:permission:decision` - Permission decision
- `rpc:fs:*` - File system operations

### `/webui` - Web UI Connections

Events from webui:
- `subscribe:session` - Subscribe to session updates
- `unsubscribe:session` - Unsubscribe from session
- `permission:decision` - Submit permission decision

Events to webui:
- `session:update` - Session state changes
- `session:error` - Error events
- `permission:request` - Permission requests
- `permission:result` - Permission outcomes
- `terminal:output` - Terminal output chunks
- `cli:status` - CLI connection status
- `sessions:list` - Updated sessions list

## Architecture

### Services

- **CliRegistry** (`services/cli-registry.ts`)
  - Tracks connected CLI instances by machineId
  - Maps sessions to CLI instances
  - Handles CLI disconnection cleanup

- **SessionRouter** (`services/session-router.ts`)
  - Routes requests to appropriate CLI
  - Manages RPC request/response correlation
  - Handles timeout for pending RPCs

### Socket Handlers

- **CLI Handlers** (`socket/cli-handlers.ts`)
  - Handle CLI registration and heartbeat
  - Process RPC responses
  - Forward events to webui subscribers

- **Webui Handlers** (`socket/webui-handlers.ts`)
  - Manage session subscriptions
  - Route permission decisions to CLI
  - Emit events to subscribed clients

## RPC Pattern

The gateway uses a request-response pattern over Socket.io:

```typescript
// Gateway sends RPC to CLI
const requestId = crypto.randomUUID();
cli.socket.emit('rpc:session:create', { requestId, params: { ... } });

// CLI responds
cli.socket.on('rpc:session:create', async (request) => {
  const result = await sessionManager.createSession(request.params);
  cli.socket.emit('rpc:response', { requestId: request.requestId, result });
});

// Gateway resolves the pending promise
sessionRouter.resolvePendingRequest(requestId, result);
```

## Development

```bash
# Run tests
pnpm test

# Lint and format
pnpm lint
pnpm format
```
