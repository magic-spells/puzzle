---
name: D63 — One frame scheduler with a hidden-tab timer fallback
status: verified
verified_at: '2026-11-01T19:23:12.785Z'
connections:
  - COMPONENT-STORE
  - DOC-DATASTORE
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/scheduler.js
  - client-runtime/datastore/store.js
  - client-runtime/app.js
---

# D63 — One frame scheduler with a hidden-tab timer fallback

Store flushes, view renders and `app.idle()` checks batch onto `requestAnimationFrame`. Chrome suspends rAF in hidden tabs, so without a fallback a backgrounded app would queue work behind a frozen frame and no subscriber would hear anything until the tab was shown.

## Decision

- The rule lives once, as `frame(run)` in `client-runtime/scheduler.js`:
  - hidden tab (`document.hidden`) or no rAF (Node, tests) → `setTimeout(0)`;
  - otherwise rAF **plus** a 220ms fallback timer, covering a tab that hides before the frame.
  - Whichever fires first runs `run`; the other does nothing.
- `schedule(job)` wraps `frame` for store flushes (`Store._scheduleFlush`, which arms both subscriber delivery and batched persistence) and `setData()` renders, and counts them for `renderTick()` ([[DECISION-D188-TICK]]) and `app.idle()` (D185).
- A frame that fires after an explicit `flush()` finds nothing pending; `flush()` is idempotent.

## Alternatives rejected

- **A `visibilitychange` listener that flushes on hide** — per-store listener lifecycle, and it misses work that starts while hidden (the schedule-time branch is needed anyway).
- **Always `setTimeout`, drop rAF** — loses frame-aligned batching on the visible path.

## Gotchas

- Hidden-tab delivery is delayed by browser timer throttling (≥1s, ~1/min after 5 min), never dropped.
- rAF-driven work outside the scheduler (animation flights) still freezes in hidden tabs, so browser checks run in a background tab can't be trusted for timing.
