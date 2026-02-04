# @mobvibe/cli

CLI daemon for remote-claude (mobvibe) - connects ACP-compatible agents to the gateway.

## Installation

Requires [Bun](https://bun.sh/) 1.0+.

```bash
npm install -g @mobvibe/cli
```

## Usage

### Login (first time)

```bash
mobvibe login
```

Opens browser for authentication, registers your machine.

### Start daemon

```bash
mobvibe start
```

### Check status

```bash
mobvibe status
```

### Stop daemon

```bash
mobvibe stop
```

## Environment Variables

- `MOBVIBE_GATEWAY_URL` - Gateway server URL (default: from login)
- `ANTHROPIC_AUTH_TOKEN` - Required for Claude Code backend
