---
name: "D19 — Navigation semantics: commit-ordered URL, nav tokens, catch-all 404, layout reuse"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DOC-ROUTER
notes:
  - kind: state
    text: >-
      Refined by [[DECISION-D61-ATOMIC-LOCATION-COMMIT]] (2026-07-14). D19's stated intent — "URL
      and view commit atomically" — was literally true at ship time, but v1.1's sequential
      transitions (D28) later inserted an AWAITED out-animation between pushState and the actual
      mount, stretching "atomic" into a window: a navigation superseded or failed during that window
      left a phantom history entry or a URL/view divergence (the known-deferred
      doomed-nav-then-failure bug). D61 restores the original guarantee by moving ALL location side
      effects (pushState, title, memory stack, scroll-key save) into #swap's synchronous #committing
      window, after the out phase and the final token checks, immediately before mount +
      #commitState. Everything else in D19 stands unchanged: the data() gate (pushState only after
      loads resolve — still true, commit just moved later), monotonic tokens/last-wins,
      rejection-stays-put (now airtight rather than mostly-true), catch-all 404, layout reuse.
---

# D19 — Navigation semantics: commit-ordered URL, nav tokens, catch-all 404, layout reuse

Settled. See [[DOC-VIEW-LIFECYCLE]] §4. For `router.push()`, `pushState` happens after the new view's `data()` resolves so URL and view commit atomically; rapid navigations cancel via monotonic tokens, 404s fall to an optional catch-all, and consecutive routes sharing a layout class reuse the layout instance.

## Context
The audited prototype had a navigation desync bug: the URL could change without the matching view committing.

## Decision
For `router.push()`:
- `pushState` happens **after** the new view's `data()` resolves — URL and view commit atomically; failed/cancelled navigations change nothing (fixes the audited desync bug).
- Rapid navigations cancel via monotonic tokens (last wins).
- `data()` rejection logs and stays put.
- 404s go to an optional catch-all `path: '*'` route, always matched last.
- Consecutive routes sharing a layout class **reuse** the layout instance (its `data()` re-runs, `<Slot/>` content swaps via patch) — a different layout class remounts.

## Consequences
No transition animations in v1 (later added in v1.1).
