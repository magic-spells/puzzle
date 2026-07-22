---
name: D63 — store flush scheduling gains a hidden-tab timer fallback
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-STORE
  - DOC-DATASTORE
  - FEATURE-V1-29-COMPOSITION-FIXES
---

# D63 — store flush scheduling gains a hidden-tab timer fallback

## Context

`Store._notify` batches changed keys and schedules `flush()` on
`requestAnimationFrame`. Chrome **suspends rAF entirely in hidden tabs**, so a
backgrounded app goes silent: mutations commit to records, `_pendingKeys`
accumulates, and no subscriber hears anything until the tab is visible again.
Worse, `_flushScheduled` stays `true` behind the one frozen rAF, so *every*
later `_notify` while hidden piles up behind it — one stuck flush blocks all
delivery.

Real-world stings: background work writing to the store (WebSocket messages,
timers) has all dependent `data()` logic stall until visibility — unread
counters, notification side effects. And during the tarot-puzzle browser
verification it masqueraded as a broken subscription system (~20 min of
debugging; the `document.hidden` gotcha is now in three docs).

## Decision

Keep rAF as the primary scheduler (frame-aligned batching is right for the
visible case). Add two guards in `_notify`:

1. **Schedule-time branch:** if `document.hidden` (or no rAF — the existing
   node/test fallback), schedule with `setTimeout(0)` instead of rAF.
2. **Boundary fallback:** when scheduling via rAF, also arm a fallback
   `setTimeout(≈220ms)`; `flush()` clears it. This covers the race where the
   tab hides *between* scheduling and the next frame — the frozen rAF's work
   is delivered by the timer instead.

`flush()` is already idempotent (clears pending on first call; a second call
no-ops), so the rAF and the fallback timer can never double-deliver.

## Alternatives

- **`visibilitychange` listener that flushes on hide** — rejected: needs
  listener lifecycle management per store instance, and doesn't cover
  notifies that *start* while hidden — the schedule-time branch is needed
  anyway, and with it the listener is redundant.
- **Always `setTimeout`, drop rAF** — rejected: loses frame alignment for the
  visible-tab happy path (one flush per frame regardless of mutation count).
- **Dev-mode console hint when a flush is pending across a visibility change**
  — dropped as unnecessary: with the fallback in place the freeze symptom is
  gone, so there is nothing left to hint about.

## Consequences

- Hidden-tab delivery is **delayed, never dropped**: Chrome throttles hidden
  timers to ≥1 s, and to ~1/min after 5 min (intensive throttling). Subscribers
  in hidden tabs now hear about changes on that cadence instead of never.
- Visible-tab happy path unchanged except one armed-then-cleared timer per
  flush batch (negligible). If the main thread stalls past the fallback delay,
  the timer may flush *before* the rAF — an earlier flush, harmless by
  idempotence.
- Node/test environments unchanged (they already took the setTimeout path).
- The `document.hidden` debugging gotcha recorded in DESIGN.md / memory /
  [[DOC-THIRD-PARTY-DOM]] becomes historical after this ships.
