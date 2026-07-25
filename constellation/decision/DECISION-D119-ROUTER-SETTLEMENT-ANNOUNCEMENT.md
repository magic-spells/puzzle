---
name: >-
  D119 — a same-path push mid-flight returns the in-flight navigation's promise, and the route
  announcement falls back past an unchanged title
status: built
connections:
  - COMPONENT-ROUTER
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - DECISION-D83-QUERY-SNAPSHOT-REPLACE
---

Two router behavior fixes from the pre-0.3.0 review round. Neither changes the
navigation pipeline; both fix what a caller/AT user observes at its edges.

## push() settlement identity

The in-flight double-click guard (added with the D83 round) no-ops a second
`push()` to the SAME path while that navigation is still loading — correct,
but it returned a bare `Promise.resolve()`, so the second
`await router.push(path)` continued while the OLD route was still mounted:
`router.current` named the previous route and the new DOM did not exist yet.

Now the router stores the in-flight navigation's promise alongside
`#pendingNavPath` (same set/clear points), and the guard returns THAT — the
second caller settles exactly when the first navigation commits (or fails /
is superseded), i.e. the same thing the first caller sees. The
committed-same-path guard above it keeps returning `Promise.resolve()`: that
navigation already happened, an immediate resolve is the truth. A push to a
DIFFERENT path mid-flight still supersedes, unchanged.

## Announcement fallback (amends D93 / SPEC §51)

`#announceRoute()` wrote `document.title` into the live region, and §45's
title sync deliberately leaves the title alone when a route resolves no
`meta.title` — so the region's content didn't change, and `aria-live` only
announces on CHANGE. In an app with no per-route titles (the default starting
state) the announcement never fired after the first navigation; in mixed apps
it named the page the user just LEFT.

Now the router tracks `#announcedTitle` — `document.title` as of the LAST
announcement, seeded at `start()` with the pre-navigation-#0 title the
shipped HTML carries and cleared with the region in `stop()`. The title is
announced only when non-empty AND it actually moved since then; otherwise the
region receives the committed leaf route's `name`, or its `path` when the
name would repeat what the region already shows (two `/user/:id` navigations
share one name). Consecutive distinct navigations always produce a change;
titled routes announce their titles exactly as before. SPEC §51's "read,
never re-derived" posture survives with one carve-out: the fallback exists
precisely for the case where there is nothing new to read. Residual, by
design: the first announcement after `start()` still reads the title when it
moved during navigation #0 — a titled home route followed by an untitled push
announces home's title once (the pre-existing D93 posture).

## Alternatives rejected

- **Toggling the region (clear + refill) to force re-announcement of the same
  title** — announces duplicate content on every same-title navigation and
  races AT debouncing; the fallback announces something actually
  distinguishing instead.
- **Rejecting the second push() or returning the committed-state promise** —
  the guard exists so a double-click is harmless; giving the second caller
  the first navigation's own settlement is the only answer that is neither a
  lie nor a new failure mode.
