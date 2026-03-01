<p align="center">
  <img src="docs/images/banner.svg" alt="Mobvibe" width="680" />
</p>

<p align="center">
  <strong>Chat with your local AI coding agents from any device, from anywhere.</strong><br/>
  No network config, just one command.
</p>

<p align="center">
  <a href="https://github.com/Eric-Song-Nop/mobvibe/blob/master/LICENSE"><img src="https://img.shields.io/github/license/Eric-Song-Nop/mobvibe?style=flat-square&color=f59e0b" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-Web%20%7C%20Desktop%20%7C%20Mobile-6C757D?style=flat-square" alt="Platform" />
</p>

<p align="center">
  <a href="README.zh.md">中文</a> | English
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#supported-acp-agents">Agents</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#e2ee-setup">E2EE</a> &middot;
  <a href="#self-hosting">Self-Hosting</a>
</p>

---

Mobvibe is a distributed [ACP](https://agentclientprotocol.com/) (Agent Client Protocol) WebUI for local agent workflows. It connects to ACP-compatible CLIs (OpenCode, Gemini CLI, Claude Code, and [20+ more](#supported-acp-agents)), manages multi-session chat, and delivers a fast, touch-friendly experience across desktop and mobile.

<p align="center">
  <img src="docs/images/hero-desktop.png" alt="Mobvibe WebUI" width="720" />
</p>

## Features

### Multi-Agent Support

Automatically detects installed ACP agents via the [ACP Registry](https://agentclientprotocol.com). On first run, Mobvibe scans your system and lets you choose which agents to enable.

<p align="center">
  <img src="docs/images/multi-session.png" alt="Multi-agent sessions" width="640" />
</p>

### Real-Time Streaming

Live streaming chat with Markdown rendering, syntax highlighting, and inline tool results.


### End-to-End Encryption

Session content is encrypted on the CLI and decrypted on the WebUI. The gateway routes events but **cannot read your content**.

### File Explorer & @Mentions

Session-scoped file browser with code preview, Tree-sitter outline, and `@`-mention file picker for context injection.

<p align="center">
  <img src="docs/images/file-explorer.png" alt="File explorer" width="640" />
</p>

### Cross-Platform

Web, Desktop, and Mobile apps via Tauri v2. One codebase, native performance.

### Light / Dark / System Themes

Automatic theme switching with system preference detection. Supports Chinese and English.

<p align="center">
  <img src="docs/images/light-theme.png" alt="Light theme" width="49%" />
  <img src="docs/images/dark-theme.png" alt="Dark theme" width="49%" />
</p>

### How Mobvibe Compares

> This table is meant to highlight Mobvibe's feature set — no disrespect to the other projects. I'm a long-time user of all of them and truly appreciate the work behind each one.

|  | Mobvibe | CC Remote Control | Happy Coder | OpenCode WebUI |
|:--|:--:|:--:|:--:|:--:|
| **Open Source** | ✅ Apache-2.0 | ❌ | ✅ | ✅ |
| **Multi-Agent (20+ ACP)** | ✅ | ❌ Claude only | ⚠️ Claude + Codex | ❌ OpenCode only |
| **End-to-End Encryption** | ✅ | ❌ | ✅ | ❌ |
| **Remote Access without Reverse Proxy** | ✅ Hosted gateway | ✅ Anthropic relay | ✅ Hosted relay | ❌ Self-host required |
| **Code Reader + Tree-sitter Outline** | ✅ | ❌ | ❌ | ❌ |
| **Git Changes Preview** | ✅ | ❌ | ❌ | ❌ |
| **Desktop App** | ✅ Tauri v2 | ❌ | ❌ | ❌ |
| **Mobile App** | ✅ Tauri v2 | ✅ | ✅ | ❌ |
| **Themes** | ✅ Light / Dark / System | ❌ | ❌ | ✅ |
| **Create Session in Any Remote Dir** | ✅ | ❌ | ❌ | ❌ |
| **Browse & Reconnect History** | ✅ | ❌ | ✅ | ❌ |
| **Self-Hosting** | ✅ | ❌ | ✅ | ✅ |

## Supported ACP Agents

> Documentation Index: <https://agentclientprotocol.com/llms.txt>

<details>
<summary>Click to expand the full agent list</summary>

The following agents can be used with an ACP Client:

- [AgentPool](https://phil65.github.io/agentpool/advanced/acp-integration/)
- [Augment Code](https://docs.augmentcode.com/cli/acp)
- [Blackbox AI](https://docs.blackbox.ai/features/blackbox-cli/introduction)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (via [Zed's SDK adapter](https://github.com/zed-industries/claude-code-acp))
- [Codex CLI](https://developers.openai.com/codex/cli) (via [Zed's adapter](https://github.com/zed-industries/codex-acp))
- [Code Assistant](https://github.com/stippi/code-assistant?tab=readme-ov-file#configuration)
- [Docker's cagent](https://github.com/docker/cagent)
- [fast-agent](https://fast-agent.ai/acp)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Goose](https://block.github.io/goose/docs/guides/acp-clients)
- [JetBrains Junie (coming soon)](https://www.jetbrains.com/junie/)
- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli)
- [Minion Code](https://github.com/femto/minion-code)
- [Mistral Vibe](https://github.com/mistralai/mistral-vibe)
- [OpenCode](https://github.com/sst/opencode)
- [OpenHands](https://docs.openhands.dev/openhands/usage/run-openhands/acp)
- [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) (via [pi-acp adapter](https://github.com/svkozak/pi-acp))
- [Qoder CLI](https://docs.qoder.com/cli/acp)
- [Qwen Code](https://github.com/QwenLM/qwen-code)
- [Stakpak](https://github.com/stakpak/agent?tab=readme-ov-file#agent-client-protocol-acp)
- [VT Code](https://github.com/vinhnx/vtcode/blob/main/README.md#zed-ide-integration-agent-client-protocol)

</details>

### Installing Common Agents

Detection priority per agent: **Binary** (fastest) > **npx** (Node.js) > **uvx** (Python).

| Agent | Install |
|-------|---------|
| [OpenCode](https://github.com/sst/opencode) | `curl -fsSL https://opencode.ai/install \| bash` |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) | `npm install -g @anthropic-ai/claude-code` (requires `ANTHROPIC_API_KEY`) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` |
| [Codex CLI](https://developers.openai.com/codex/cli) | `npm install -g @openai/codex` (requires `OPENAI_API_KEY`) |
| [Goose](https://block.github.io/goose/docs/guides/acp-clients) | See [installation guide](https://block.github.io/goose/docs/guides/acp-clients) |
| [Aider](https://aider.chat) | `pip install aider-chat` |

After installing a new agent, restart Mobvibe and it will be detected automatically.

## Quick Start

```bash
npx @mobvibe/cli login
npx @mobvibe/cli start
```

Then open [app.mobvibe.net](https://app.mobvibe.net) in your browser. On first run, Mobvibe will scan your system for installed ACP agents and ask you to choose which ones to enable.

<details>
<summary>CLI Commands</summary>

| Command | Description |
|---------|-------------|
| `mobvibe login` | Authenticate and generate E2EE master secret |
| `mobvibe logout` | Remove stored credentials |
| `mobvibe auth-status` | Show authentication status |
| `mobvibe start [--gateway <url>]` | Start daemon |
| `mobvibe stop` | Stop daemon |
| `mobvibe status` | Show daemon status |
| `mobvibe logs [-f] [-n <lines>]` | View daemon logs |
| `mobvibe e2ee show` | Display master secret for WebUI pairing |
| `mobvibe e2ee status` | Show E2EE key status |

</details>

<details>
<summary>Configuration</summary>

| Variable | Description |
|----------|-------------|
| `MOBVIBE_GATEWAY_URL` | Gateway URL (default: `https://api.mobvibe.net`) |
| `MOBVIBE_HOME` | CLI home directory (default: `~/.mobvibe`) |
| `MOBVIBE_ENABLED_AGENTS` | Comma-separated agent IDs to enable (overrides config) |

Advanced configuration is stored in `~/.mobvibe/.config.json`:

| Field | Description |
|-------|-------------|
| `enabledAgents` | Array of enabled agent IDs (e.g. `["claude-code"]`) |
| `worktreeBaseDir` | Git worktree root (default: `~/.mobvibe/worktrees`) |

</details>

## E2EE Setup

<details>
<summary>Click to expand E2EE setup instructions</summary>

### 1. Login (CLI)

```bash
mobvibe login
```

Enter email and password. This authenticates with the gateway, generates a master secret, and registers the device. The master secret is displayed at the end — copy it for step 2.

### 2. Pair WebUI

Open WebUI → Settings → End-to-End Encryption → paste the master secret → click "Pair".

To view the secret again later: `mobvibe e2ee show`

### 3. Start daemon

```bash
mobvibe start
```

All session content is now encrypted end-to-end. The gateway routes events but cannot read their content.

</details>

## Architecture

```
┌──────────────┐          ┌──────────────┐          ┌──────────────────┐
│              │  WS/HTTP │              │  WS/HTTP │                  │
│   WebUI      │◄────────►│   Gateway    │◄────────►│   CLI Daemon     │
│  (Browser)   │  (E2EE)  │  (Relay)     │  (E2EE)  │  (Local Machine) │
│              │          │              │          │                  │
└──────────────┘          └──────────────┘          └────────┬─────────┘
                                                             │ stdio
                                                    ┌────────▼─────────┐
                                                    │   ACP Agents     │
                                                    │  (claude-code,   │
                                                    │   opencode, ...) │
                                                    └──────────────────┘
```

- **WebUI** — React 19 + Vite frontend (Web / Desktop / Mobile via Tauri v2)
- **Gateway** — Express + Socket.io relay server; routes encrypted events between WebUI and CLI
- **CLI Daemon** — Bun-based local process that manages ACP agent lifecycles
- **ACP Agents** — Any ACP-compatible coding agent (Claude Code, OpenCode, Gemini CLI, etc.)

## Self-Hosting

Mobvibe can be self-hosted. The infrastructure is defined in `render.yaml` at the repository root. See the [source repository](https://github.com/Eric-Song-Nop/mobvibe) for details.

## Development

### Prerequisites

- Node.js >= 22
- [pnpm](https://pnpm.io/) >= 9
- [Bun](https://bun.sh/) (for mobvibe-cli)

### Setup

```bash
git clone https://github.com/Eric-Song-Nop/mobvibe.git
cd mobvibe
pnpm install
pnpm dev
```

## Documentation

- [ACP Protocol](https://agentclientprotocol.com/)
- [ACP TypeScript SDK](https://agentclientprotocol.github.io/typescript-sdk/)

## License

[Apache-2.0](LICENSE)
