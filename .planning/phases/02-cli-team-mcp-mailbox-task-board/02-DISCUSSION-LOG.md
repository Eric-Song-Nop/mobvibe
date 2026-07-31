# Phase 2: CLI Team MCP、Mailbox 与 Task Board - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13T10:53:03Z
**Phase:** 2-CLI Team MCP、Mailbox 与 Task Board
**Areas discussed:** MCP 注入路径, 工具边界与权限, Mailbox 唤醒语义, Task Board 合约

---

## MCP 注入路径

| Option | Description | Selected |
|--------|-------------|----------|
| Native first | Implement RFD-native ACP transport registry, declarations, connect/message routing, and readiness. | ✓ |
| Declaration first | Generate declarations and readiness states first, defer full callbacks. | |
| Bridge MVP | Mainly replicate AionUI stdio bridge, leave native ACP as future work. | |

**User's choice:** Native first.
**Notes:** User explicitly required MCP-over-ACP as the Agent Team MCP reference.

| Option | Description | Selected |
|--------|-------------|----------|
| Local extension | Locally model RFD `acp` transport while avoiding SDK upgrade risk. | |
| Upgrade SDK | Upgrade `@agentclientprotocol/sdk` first to use official support if available. | ✓ |
| Cast only | Use type assertions to pass RFD declarations through current SDK types. | |

**User's choice:** Upgrade SDK.
**Notes:** Research/planning should investigate the current SDK version and upgrade path before implementing local shims.

| Option | Description | Selected |
|--------|-------------|----------|
| Per-member id | Bind each member session to a unique ACP MCP server id. | ✓ |
| Per-team id | One team id plus caller parameter in tool calls. | |
| Token meta | Caller token in metadata/env; more suitable for bridge fallback. | |

**User's choice:** Per-member id.

| Option | Description | Selected |
|--------|-------------|----------|
| After tool list | Mark ready after the expected tools are listable. | ✓ |
| After connect | Mark ready after `mcp/connect` returns. | |
| After first call | Mark ready only after the first successful tool call. | |

**User's choice:** After tool list.

---

## 工具边界与权限

| Option | Description | Selected |
|--------|-------------|----------|
| Core plus intents | Implement core coordination tools plus spawn/rename/shutdown intents. | ✓ |
| Aion parity | Include actual AionUI-style spawn/rename/shutdown behavior now. | |
| Coordination only | Only mailbox and task tools. | |

**User's choice:** Core plus intents.

| Option | Description | Selected |
|--------|-------------|----------|
| Risk only | High-risk tools leader-only, basic tools member-usable. | |
| Most tools | Most tools leader-only. | |
| Open team | Broad member access. | |
| No role lock | No tools are leader-only. | ✓ |
| Soft leader | Non-leader high-risk calls create requests. | |
| Requirement wins | Preserve earlier leader-only assumption. | |

**User's choice:** No role lock.
**Notes:** User first answered “nothing”; follow-up clarified that no team tool should have a hard leader/member role lock.

| Option | Description | Selected |
|--------|-------------|----------|
| Durable request | Persist high-risk request pending confirmation. | |
| Prompt contract | Rely on prompt/tool descriptions for approval. | |
| Immediate deny | Return not executable until later phase. | |
| Cancel gates | Cancel team tool-layer user confirmation and permission gates. | ✓ |
| Tool gates only | Cancel leader-only but keep user confirmation. | |
| Keep safety | Keep original safety gate model. | |

**User's choice:** Cancel gates.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep ACP perms | Keep ordinary ACP session permissions unchanged. | ✓ |
| Bypass ACP too | Auto-pass underlying ACP permissions too. | |
| Backend default | Do not add or bypass backend defaults. | |

**User's choice:** Keep ACP perms.

---

## Mailbox 唤醒语义

| Option | Description | Selected |
|--------|-------------|----------|
| Persist accepted | Durable write means accepted; wake result is separate. | ✓ |
| Wake required | Send succeeds only if wake also succeeds. | |
| Best effort | Soft-success even around write failures. | |

**User's choice:** Persist accepted.

| Option | Description | Selected |
|--------|-------------|----------|
| Inject on wake | Wake reads unread messages and injects them into ordinary session history/input. | ✓ |
| Tool only | Agent must explicitly read/list mailbox. | |
| Metadata only | Body never enters session context. | |

**User's choice:** Inject on wake.

| Option | Description | Selected |
|--------|-------------|----------|
| Name plus star | Resolve member name/memberId and support `*` broadcast excluding sender. | ✓ |
| MemberId only | Require exact memberId. | |
| Roles too | Add aliases like leader/all/members. | |

**User's choice:** Name plus star.

| Option | Description | Selected |
|--------|-------------|----------|
| Aion idle guard | System idle notification and all-settled leader wake guard. | ✓ |
| No idle yet | Defer idle notifications. | |
| Always wake lead | Wake leader after every member turn. | |

**User's choice:** Aion idle guard.

---

## Task Board 合约

| Option | Description | Selected |
|--------|-------------|----------|
| Shared statuses | Use Mobvibe `todo/in_progress/blocked/completed/failed/cancelled`. | ✓ |
| Aion statuses | Use AionUI `pending/in_progress/completed/deleted`. | |
| Minimal three | Only `todo/in_progress/completed`. | |

**User's choice:** Shared statuses.

| Option | Description | Selected |
|--------|-------------|----------|
| Name plus id | Accept member name/memberId, persist memberId. | ✓ |
| MemberId only | Require exact memberId. | |
| Freeform owner | Allow any owner text. | |

**User's choice:** Name plus id.

| Option | Description | Selected |
|--------|-------------|----------|
| Auto unblock | Maintain bidirectional deps and unblock downstream tasks on completion. | ✓ |
| Store only | Store deps without automatic changes. | |
| No deps | Do not implement dependency graph. | |

**User's choice:** Auto unblock.

| Option | Description | Selected |
|--------|-------------|----------|
| Full local | MCP tools may return full CLI-local task content to agents. | ✓ |
| Metadata only | Tool returns only id/status/owner. | |
| Summary only | Tool returns maintained summaries. | |

**User's choice:** Full local.

---

## the agent's Discretion

- Exact internal module/helper names are left to implementation agents, as long as boundaries remain clear.

## Deferred Ideas

- Full WebUI create/detail flow is Phase 3.
- Cancel/retry/archive and permission aggregation UI are Phase 4.
- UI scale/polish is Phase 5.
