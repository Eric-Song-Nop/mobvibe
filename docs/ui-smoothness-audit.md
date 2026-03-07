# UI Smoothness Audit

Date: 2026-03-08

This note documents the main reasons the current `apps/webui` UI can feel less smooth during chat streaming, scrolling, terminal output, and input.

## Conclusion

The main gap is not visual styling or animation polish. The main gap is update isolation.

`apps/webui` currently lets streaming session updates fan out through the top-level app shell, the chat list, tool call cards, and the composer more often than necessary.

## Primary Findings

### 1. Top-level session subscription is too broad

`apps/webui` subscribes to the full `sessions` map in the app shell and derives both the active chat state and sidebar state from that shared subscription.

Relevant files:

- `apps/webui/src/App.tsx`
- `apps/webui/src/hooks/useSessionList.ts`

Impact:

- Every streamed token, tool-call update, and terminal delta can force the shell to recalculate active session state and sidebar lists.
- Sidebar and chat shell work gets coupled to hot streaming updates.

### 2. Chat auto-scroll uses a continuous RAF loop

`apps/webui` uses a `requestAnimationFrame` loop while streaming and writes `scrollTop` every frame.

Relevant file:

- `apps/webui/src/components/app/ChatMessageList.tsx`

Impact:

- Repeated layout reads and writes while message height is still changing.
- Higher chance of scroll jitter and visible "chasing" during streaming.

### 3. Tool call cards subscribe too broadly to terminal output

Each tool call card in `apps/webui` reads the full `terminalOutputs` map for the session.

Relevant files:

- `apps/webui/src/components/chat/MessageItem.tsx`
- `apps/webui/src/lib/chat-store.ts`

Impact:

- A delta for one terminal can rerender every visible tool-call card in the same session.
- Tool-heavy conversations will feel progressively less smooth.

This is especially costly because terminal output updates are frequent and the store recreates the session output map on each append.

### 4. Markdown rendering path is heavier and less specialized

`apps/webui` routes assistant and thought content through `streamdown` via a lazy wrapper.

Relevant files:

- `apps/webui/src/components/chat/LazyStreamdown.tsx`
- `apps/webui/src/components/chat/MessageItem.tsx`

Impact:

- Repeated message updates cost more during streaming.
- Cached code highlighting and memoized markdown work are limited in `apps/webui`.

### 5. Composer input path does more manual DOM work

`apps/webui` uses a contenteditable editor with explicit parsing, beforeinput interception, paste interception, and DOM reconciliation.

Relevant file:

- `apps/webui/src/components/app/ChatFooter.tsx`

Impact:

- Higher chance of input lag when text is long or mentions/resources are involved.
- More work on each edit and selection mutation.

### 6. React Compiler is not enabled

Relevant file:

- `apps/webui/vite.config.ts`

`apps/webui` does not currently enable `babel-plugin-react-compiler`. That is not the root cause on its own, but it could help reduce rerender overhead on top of the architectural issues above.

## Build Evidence

A local production build was completed for `apps/webui`.

Observed large client chunks:

- main chunk about `1096 kB`
- mermaid chunk about `1794 kB`

This supports the main conclusion that runtime update strategy matters more than visual styling alone.

## Priority Fix Order

1. Narrow state subscriptions so chat streaming does not rerender the whole shell.
2. Replace the continuous chat auto-scroll RAF loop with virtualizer-aware resize and scroll adjustment logic.
3. Scope terminal output subscriptions to the specific `terminalId` used by each card.
4. Reduce markdown rerender cost on streaming assistant messages.
5. Revisit the composer implementation if input lag remains after the first four changes.

## Recommended First Patch Set

If this is turned into implementation work, the first pass should target:

- `apps/webui/src/App.tsx`
- `apps/webui/src/hooks/useSessionList.ts`
- `apps/webui/src/components/app/ChatMessageList.tsx`
- `apps/webui/src/components/chat/MessageItem.tsx`
- `apps/webui/src/lib/chat-store.ts`

That should produce the largest visible improvement with the smallest product risk.
