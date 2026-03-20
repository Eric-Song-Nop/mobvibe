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

## No Backends Available

`mobvibe start` now fails fast with exit code `1` when it resolves zero usable ACP backends. This happens before foreground startup, background daemon spawn, or PID file creation.

If startup aborts, edit `~/.mobvibe/.config.json` and set `enabledAgents` manually:

```json
{
  "enabledAgents": ["claude-acp", "codex-acp", "opencode"]
}
```

When registry data was fetched from the network or loaded from cache, the CLI prints the exact selectable agent IDs from that registry. Use those printed IDs as the authoritative list for your current machine and registry snapshot.

When the registry is unavailable and no cache exists, the CLI prints example IDs such as `claude-acp`, `codex-acp`, and `opencode`. Those are examples only, not a guaranteed complete or authoritative offline list.

Editing `enabledAgents` alone is not always sufficient offline. If the registry cannot be fetched and there is no cached copy, or if required launchers are missing, fix connectivity and/or make sure `npx`, `uvx`, or the agent binary is available in `PATH`, then retry `mobvibe start`.

## Commands

| Command | Description |
|---------|-------------|
| `mobvibe login` | Authenticate with email/password, generate master secret, register device |
| `mobvibe logout` | Remove stored credentials |
| `mobvibe auth-status` | Show authentication and key status |
| `mobvibe start [--gateway <url>] [--no-e2ee]` | Start daemon |
| `mobvibe stop` | Stop daemon |
| `mobvibe status` | Show daemon status |
| `mobvibe logs [-f] [-n <lines>]` | View daemon logs |
| `mobvibe e2ee show` | Display master secret for WebUI pairing |
| `mobvibe e2ee status` | Show E2EE key status (public key fingerprints) |
| `mobvibe compact [--session <id>]` | Compact WAL database |

## E2EE

All session content is encrypted on the CLI before sending to the gateway. The gateway routes events but cannot read their content.

Need a plaintext session for debugging or local testing? Start with `mobvibe start --no-e2ee`. This keeps CLI authentication enabled for that run, but skips session DEK generation and content encryption.

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
| `MOBVIBE_MACHINE_ID` | Machine identifier (default: auto-generated) |
| `MOBVIBE_SHELL` | Shell for command execution (default: `$SHELL` or `/bin/sh`) |
| `MOBVIBE_ENABLED_AGENTS` | Comma-separated list of enabled agents |
| `MOBVIBE_COMPACTION_ENABLED` | Enable automatic WAL event compaction (default: `false`) |
| `MOBVIBE_CONSOLIDATION_ENABLED` | Enable WAL event consolidation (default: `true`) |
| `LOG_LEVEL` | Log level: `debug` / `info` / `warn` / `error` (default: `info`) |

See `.env.example` for a fully commented template.
