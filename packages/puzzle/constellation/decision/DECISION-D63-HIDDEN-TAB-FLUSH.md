---
name: D63 — store flush scheduling gains a hidden-tab timer fallback
status: verified
verified_at: '2026-08-24T21:39:15.808Z'
connections:
  - COMPONENT-STORE
  - DOC-DATASTORE
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/datastore/store.js
  - client-runtime/app.js
---

# D63 — store flush scheduling gains a hidden-tab timer fallback

## Context

`Store` batches changed keys and flushes on `requestAnimationFrame`. Chrome
suspends rAF in hidden tabs, so a backgrounded app would queue mutations behind
one frozen rAF and no subscriber would hear anything until the tab was visible.

## Decision

rAF stays the primary scheduler. `_scheduleFlush` — the single arming point for
both `_notify` (subscriber delivery) and `_persist` (batched storage write) —
adds two guards:

1. If `document.hidden` (or no rAF, as in node/tests), schedule with
   `setTimeout(0)`.
2. When scheduling via rAF, also arm a ~220ms fallback timer that `flush()`
   clears — covers a tab hiding between scheduling and the next frame.

`flush()` is idempotent, so rAF and the fallback never double-deliver.

## Alternatives

- **`visibilitychange` listener that flushes on hide** — rejected: per-store
  listener lifecycle, and it misses notifies that start while hidden (the
  schedule-time branch is needed anyway).
- **Always `setTimeout`, drop rAF** — rejected: loses frame-aligned batching on
  the visible path.

## Consequences

- Hidden-tab delivery is delayed (browser timer throttling: ≥1s, ~1/min after
  5 min), never dropped.
- If the main thread stalls past the fallback delay, the timer may flush before
  the rAF — harmless by idempotence.
- rAF-driven work outside the store (animation flights) is still frozen in
  hidden tabs, so browser checks in a background tab can't be trusted for
  timing.
