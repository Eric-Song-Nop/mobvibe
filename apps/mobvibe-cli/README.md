# mobvibe-cli

CLI daemon that manages ACP (Agent Client Protocol) sessions and connects to the gateway.

## Overview

The mobvibe-cli acts as a bridge between the gateway and ACP-compatible CLIs:
- Connects to gateway via Socket.io
- Spawns and manages ACP CLI processes (claude-code, opencode, gemini-cli)
- Handles session lifecycle, messaging, and permissions
- Forwards real-time updates to the gateway

```
┌──────────────┐     Socket.io     ┌───────────────┐
│   gateway    │◄─────────────────►│  mobvibe-cli  │
│    :3005     │                   │   (daemon)    │
└──────────────┘                   └───────┬───────┘
                                           │
                                     stdin/stdout
                                           │
                                   ┌───────▼───────┐
                                   │   ACP CLI     │
                                   │ (claude-code) │
                                   └───────────────┘
```

## Installation

The CLI is part of the monorepo:

```bash
# From monorepo root
pnpm install
pnpm build
```

## Usage

```bash
# Start the daemon
./bin/mobvibe.mjs start [options]

# Stop the daemon
./bin/mobvibe.mjs stop

# Check daemon status
./bin/mobvibe.mjs status
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--gateway <url>` | `http://localhost:3005` | Gateway server URL |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MOBVIBE_GATEWAY_URL` | Gateway URL (alternative to --gateway) |
| `MOBVIBE_ACP_BACKENDS` | Comma-separated backend IDs (e.g., "claude-code,opencode") |
| `MOBVIBE_HOME` | Data directory (default: `~/.mobvibe`) |
| `MOBVIBE_MACHINE_ID` | Custom machine identifier |
| `ANTHROPIC_AUTH_TOKEN` | API key for Claude Code backend |
| `ANTHROPIC_BASE_URL` | Custom Anthropic API URL |

## Supported Backends

| Backend ID | CLI Command | Description |
|------------|-------------|-------------|
| `opencode` | `opencode acp` | OpenCode AI assistant |
| `gemini-cli` | `gemini --experimental-acp` | Google Gemini CLI |
| `claude-code` | `claude-code-acp` | Claude Code (Anthropic) |

## Architecture

### Core Components

**`src/acp/acp-connection.ts`**
- Manages individual ACP CLI connections
- Spawns processes, handles stdin/stdout communication
- Implements session lifecycle (idle → connecting → ready → stopped)
- Handles terminal output streaming

**`src/acp/session-manager.ts`**
- Orchestrates multiple ACP sessions
- Routes permission requests to the correct session
- Aggregates session state and emits updates
- Manages session-to-connection mapping

**`src/daemon/daemon.ts`**
- PID file management (`~/.mobvibe/daemon.pid`)
- Background process spawning
- Graceful shutdown handling

**`src/daemon/socket-client.ts`**
- Socket.io client to gateway
- RPC handlers for gateway commands
- Event forwarding from ACP to gateway
- Auto-reconnection with exponential backoff

### RPC Handlers

The socket client handles these RPC calls from the gateway:

| Event | Handler | Description |
|-------|---------|-------------|
| `rpc:session:create` | `sessionManager.createSession()` | Create new session |
| `rpc:session:close` | `sessionManager.closeSession()` | Close session |
| `rpc:session:cancel` | `sessionManager.cancelSession()` | Cancel operation |
| `rpc:session:mode` | `sessionManager.setSessionMode()` | Change mode |
| `rpc:session:model` | `sessionManager.setSessionModel()` | Change model |
| `rpc:message:send` | `connection.prompt()` | Send message |
| `rpc:permission:decision` | `sessionManager.resolvePermissionRequest()` | Permission decision |
| `rpc:fs:roots` | Get working directory | File system roots |
| `rpc:fs:entries` | List directory | Directory entries |
| `rpc:fs:file` | Read file | File content |
| `rpc:fs:resources` | List all files | Resource listing |

### Events Forwarded to Gateway

| Event | Description |
|-------|-------------|
| `session:update` | Session state changes, messages, mode/model updates |
| `session:error` | Errors during session operation |
| `permission:request` | Tool permission requests |
| `permission:result` | Permission decision outcomes |
| `terminal:output` | Terminal output chunks |
| `sessions:list` | Current sessions list (on heartbeat) |

## Development

```bash
# Development with hot reload
pnpm dev

# Build TypeScript
pnpm build

# Run built CLI
node dist/index.js start

# Lint and format
pnpm lint
pnpm format

# Run tests
pnpm test
```

## Data Directory

The daemon stores data in `~/.mobvibe/`:

```
~/.mobvibe/
├── daemon.pid       # PID file for running daemon
└── logs/            # Log files
```

## Session Lifecycle

1. **Gateway Request**: Gateway sends `rpc:session:create` with cwd and backendId
2. **Process Spawn**: CLI spawns appropriate ACP backend process
3. **Handshake**: ACP handshake via stdin/stdout
4. **Session Ready**: Session created, CLI emits `session:update`
5. **Messaging**: Gateway routes messages via `rpc:message:send`
6. **Permissions**: Tool calls trigger `permission:request` events
7. **Cleanup**: Session close triggers process termination

## Troubleshooting

### "Cannot connect to gateway"

1. Ensure gateway is running on the specified URL
2. Check network connectivity
3. Verify CORS settings on gateway

### "Backend not found"

1. Ensure the ACP CLI is installed and in PATH
2. Check `MOBVIBE_ACP_BACKENDS` environment variable
3. Verify backend command works: `which claude-code-acp`

### "Permission denied"

1. For Claude Code: Set `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`
2. Check file system permissions in working directory
