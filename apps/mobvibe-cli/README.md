# @mobvibe/cli

CLI daemon for mobvibe — connects ACP-compatible agents to the gateway with end-to-end encryption.

## Installation

Requires [Bun](https://bun.sh/) 1.0+.

```bash
npm install -g @mobvibe/cli
```

## Quick Start

```bash
# 1. Authenticate and generate E2EE master secret
mobvibe login

# 2. Start the daemon
mobvibe start
```

After login, copy the displayed master secret and paste it into WebUI Settings > End-to-End Encryption > Pair.

## Commands

| Command | Description |
|---------|-------------|
| `mobvibe login` | Authenticate with email/password, generate master secret, register device |
| `mobvibe logout` | Remove stored credentials |
| `mobvibe auth-status` | Show authentication and key status |
| `mobvibe start [--gateway <url>]` | Start daemon |
| `mobvibe stop` | Stop daemon |
| `mobvibe status` | Show daemon status |
| `mobvibe logs [-f] [-n <lines>]` | View daemon logs |
| `mobvibe e2ee status` | Show E2EE key status (public key fingerprints) |
| `mobvibe compact [--session <id>]` | Compact WAL database |

## E2EE

All session content is encrypted on the CLI before sending to the gateway. The gateway routes events but cannot read their content.

**Login flow:**

1. `mobvibe login` prompts for email and password (password masked)
2. Authenticates via Better Auth session cookie
3. Generates a 32-byte master secret and derives an Ed25519 keypair
4. Registers the device public key with the gateway
5. Saves the master secret to `~/.mobvibe/credentials.json` (mode 0600)
6. Displays the master secret (base64) for WebUI pairing

**Runtime encryption:**

- Each session gets a random DEK (data encryption key)
- Events are encrypted with `crypto_secretbox` (XSalsa20-Poly1305)
- DEKs are wrapped with `crypto_box_seal` so only paired devices can unwrap them
- CLI authenticates to the gateway with Ed25519 signed tokens (no stored API keys)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MOBVIBE_GATEWAY_URL` | Gateway server URL (default: production) |
| `MOBVIBE_HOME` | CLI home directory (default: `~/.mobvibe`) |
| `MOBVIBE_MASTER_SECRET` | Override master secret (base64, instead of credentials file) |
