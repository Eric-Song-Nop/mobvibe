# PR #21 Review: E2EE DEK Timing Race Fix

**Reviewer:** Claude (automated)
**Date:** 2026-02-24
**Focus:** E2EE DEK flow correctness

## Overview

This PR fixes a race condition where encrypted socket events arrive before the DEK (Data Encryption Key) has been unwrapped — particularly after initial pairing or reconnection. The approach adds event buffering, an `onDekReady` notification mechanism, and removes premature `isEnabled()` gates.

The overall architecture is sound, but there is **one critical correctness bug** in the backfill path that will silently drop encrypted events.

---

## CRITICAL: Backfill-buffered encrypted events are silently dropped on flush

**Files:** `useSocket.ts` backfill `onEvents` handler + `onDekReady` flush handler

In the backfill `onEvents` handler, encrypted events are buffered **and the cursor is advanced**:

```typescript
// backfill onEvents
if (isEncryptedPayload(rawEvent.payload) && !e2ee.hasSessionDek(sessionId)) {
    buf.push(rawEvent);
    encryptedBufferRef.current.set(sessionId, buf);
    updateSessionCursor(sessionId, rawEvent.revision, rawEvent.seq);  // cursor advanced!
    continue;
}
```

When the DEK becomes ready, the flush handler re-processes them through `handleSessionEventRef`:

```typescript
// onDekReady flush
for (const rawEvent of buffered) {
    handleSessionEventRef.current?.(rawEvent);  // goes through normal handler
}
```

But `handleSessionEventRef` checks the cursor and skips "already-applied" events:

```typescript
// inside handleSessionEventRef
if (event.seq <= lastSeq) {
    return;  // SKIPPED — cursor was already advanced past this seq
}
```

**Result:** All encrypted events received via backfill are **silently lost** after the DEK becomes available. The cursor says they were applied, but `applySessionEventRef` was never called for them.

### Trace example

1. Backfill delivers seq=5 (encrypted, no DEK) → buffered, cursor=5
2. Backfill delivers seq=6 (encrypted, no DEK) → buffered, cursor=6
3. DEK becomes ready, `onDekReady` fires
4. Flush: `handleSessionEventRef(seq=5)` → decrypts → checks `lastAppliedSeq=6` → `5 <= 6` → **dropped**
5. Flush: `handleSessionEventRef(seq=6)` → decrypts → checks `lastAppliedSeq=6` → `6 <= 6` → **dropped**

### Suggested fix

The flush handler should decrypt and apply directly, bypassing cursor checks:

```typescript
e2ee.onDekReady((sessionId) => {
    const buffered = encryptedBufferRef.current.get(sessionId);
    if (!buffered || buffered.length === 0) return;
    encryptedBufferRef.current.delete(sessionId);

    for (const rawEvent of buffered) {
        const event = e2ee.decryptEvent(rawEvent);
        applySessionEventRef.current?.(event);
    }
});
```

However, this introduces a second problem (see next issue).

---

## MODERATE: Shared buffer between backfill and live paths has incompatible cursor semantics

`encryptedBufferRef` is a single shared buffer written to by two paths with **different cursor behaviors**:

| Path | Cursor advanced on buffer? |
|------|---------------------------|
| Backfill `onEvents` | Yes (`updateSessionCursor`) |
| Live `handleSessionEventRef` | No (early `return`) |

When flushing, the handler cannot distinguish which events came from which path. If we bypass cursor checks (to fix the critical bug above), live-buffered events won't have their cursors updated. If we keep cursor checks, backfill-buffered events are dropped.

### Suggested fix

Use separate buffers for backfill and live paths, or tag buffered events with their source. Alternatively, always advance the cursor when buffering (in both paths) and always use `applySessionEventRef` (not `handleSessionEventRef`) when flushing, then update cursor only for live-buffered events.

---

## MODERATE: Live-buffered events skip gap detection

In `handleSessionEventRef`, when an encrypted event is buffered, the handler returns early:

```typescript
if (isEncryptedPayload(incomingEvent.payload) && !e2ee.hasSessionDek(...)) {
    buf.push(incomingEvent);
    return;  // no gap detection, no cursor update
}
```

If events arrive out-of-order (e.g., seq 5 is buffered but seq 7 arrives next), the gap between 5 and 7 won't be detected until flush time. Backfill is delayed until the DEK arrives and the buffer is flushed, which could be much later.

---

## MINOR: `onDekReady` fires on duplicate unwrap

`notifyDekReady` is called from `tryUnwrap`, which runs on every `unwrapSessionDek` call — even for sessions that already have a DEK. The test explicitly acknowledges this ("acceptable; consumers should be idempotent"), but it means every `sessionsChanged` event triggers notifications for all sessions, causing unnecessary flush attempts on empty buffers.

Consider guarding with `!this.sessionDeks.has(sessionId)` before setting + notifying in `tryUnwrap`.

---

## MINOR: Unnecessary `useRef(useQueryClient())` in `TauriPairHandler`

```typescript
const queryClientRef = useRef(useQueryClient());
```

`useQueryClient()` returns a stable reference (guaranteed by React Query). A simple `const queryClient = useQueryClient()` is sufficient and more idiomatic.

---

## What the PR gets right

- **Removing the `isEnabled()` gate** on DEK unwrap is correct. The old gate prevented DEK unwrap immediately after pairing because the unwrap call and `isEnabled()` check happened at different lifecycle points.

- **`unwrapAllSessionDeks` with skip optimization** prevents redundant crypto operations during bulk unwrap.

- **`onDekReady` pub/sub pattern** is a clean decoupling of DEK readiness from event processing.

- **Post-pairing immediate unwrap** in both `TauriPairHandler` and `E2EESettings` (reading from React Query cache) minimizes the window where events arrive without a DEK.

- **Test coverage** for `onDekReady`, `hasSessionDek`, and `unwrapAllSessionDeks` is thorough.

---

## Summary

| Severity | Issue | Location |
|----------|-------|----------|
| **Critical** | Backfill-buffered events silently dropped on flush (cursor already advanced) | `useSocket.ts` backfill + flush |
| Moderate | Shared buffer with incompatible cursor semantics between backfill/live | `useSocket.ts` `encryptedBufferRef` |
| Moderate | Gap detection skipped for live-buffered encrypted events | `useSocket.ts` `handleSessionEventRef` |
| Minor | `onDekReady` fires on duplicate unwrap | `e2ee.ts` `tryUnwrap` |
| Minor | Unnecessary `useRef(useQueryClient())` | `App.tsx` `TauriPairHandler` |

**Recommendation:** The critical bug means that any E2EE session whose history is loaded via backfill while the DEK is unavailable will have missing messages — exactly the reconnect scenario this PR is trying to fix. This needs to be addressed before merge.
