---
name: "D41 — Anchor-target scrolling + sessionStorage position persistence (v1.10)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D34-HASH-ROUTING
  - DECISION-D39-SKELETON
  - FEATURE-V1-10-SCROLL-FOLLOWUPS
---

# D41 — Anchor-target scrolling + sessionStorage position persistence (v1.10)

The two items [[DECISION-D33-ROUTER-SCROLL]] deferred, shipped together as v1.10:
a `#anchor` suffix on a navigation target scrolls the landed page to that element,
and saved scroll positions persist in `sessionStorage` so back/forward restore
survives a full reload. Router-only, config-free (the existing `scrollBehavior`
contract is unchanged — `false` still disables everything, a custom function still
wins). See [[DOC-SPEC]] §14.

## Context
v1.5 (D33) made the router own window scroll but explicitly cut two things: anchor
targets (navigating to `/docs#faq` landed at top, and the link interceptor silently
*dropped* `url.hash` in history mode) and reload persistence (positions lived in an
in-memory Map, so refresh + back lost restoration). Both were carded as "small,
router-only, independently shippable" (the old FEATURE-SCROLL-FOLLOWUPS card, now
[[FEATURE-V1-10-SCROLL-FOLLOWUPS]]).

## Decision
Sub-decisions, each with its rejected alternative:

- **Anchor is a default-behavior refinement, resolved at commit.** On a **push**
  whose target path carries `#anchor`, the default landing becomes "the position of
  `document.getElementById(anchor)`" (id decoded with `decodeURIComponent`),
  **falling back to top** when no such element exists in the committed DOM. On a
  **pop**, a saved position still wins (restore semantics beat anchors — the user
  is returning to where they were). A custom `scrollBehavior` function still wins
  over everything; it can see the anchor because `to.path` carries it verbatim.
  Resolution happens **inside `#commitState`, after mount** — an element position
  cannot be computed before the view is in the DOM. The D19/D33 timing contract is
  unchanged: synchronous after mount, before paint, after the old view's `out`.
  (Rejected: a vue-router-style `{ el }` return shape for custom `scrollBehavior`
  functions — the default covers the actual use case; widening the return contract
  can ship later without breaking anything.)
- **Skeleton views resolve the anchor against whatever committed.** A v1.8
  skeleton view (D39) commits before `data()` resolves; its anchor target usually
  isn't in the skeleton DOM, so the landing falls back to top. Deferring the scroll
  until `loaded` would reintroduce exactly the late-jump D33 was designed to avoid.
  (Rejected: re-resolving the anchor when the real template lands.)
- **The history-mode link interceptor preserves the fragment.** It now pushes
  `url.pathname + url.search + url.hash` (previously the hash was dropped). A bare
  `#anchor` href is still left to the browser — native in-page anchors are not the
  router's business.
- **Hash mode uses the in-fragment double-hash convention.** `push('/docs#faq')`
  writes `#/docs#faq`; `location.hash` returns the whole fragment, `#currentPath`'s
  existing `#/` parse yields `/docs#faq`, and matching already strips at `#`. An
  `<a href="#/docs#faq">` is intercepted by the existing `#/` rule. This does not
  conflict with the SPEC §15 bare-anchor limitation: bare `#faq` hrefs remain
  native (and remain a documented hazard in hash mode). (Rejected: declaring
  anchors unsupported in hash mode — the convention costs nothing and gives
  hash-mode apps their only non-clobbering anchor mechanism. RFC 3986 technically
  forbids `#` inside a fragment, but every browser tolerates it and returns the
  full fragment from `location.hash`; noted, accepted.)
- **Persistence piggybacks on the existing keys, capped, fail-soft.** The
  in-memory Map stays the source of truth; every save mirrors the Map to a single
  `sessionStorage` key (`__puzzleScroll`), and `start()` hydrates the Map from it.
  Per-entry `__puzzleScrollKey`s already ride in `history.state`, which itself
  survives reloads — that is what makes cross-reload restore line up. The Map is
  capped at **50 entries, oldest evicted** (insertion order; a re-save re-inserts).
  All storage access is `try/catch`-wrapped: quota, disabled storage, or `file://`
  oddities degrade to exactly the v1.5 in-memory behavior. `scrollBehavior: false`
  touches no storage. (Rejected: per-entry storage keys — n keys need their own
  eviction index, one blob is simpler and small; rejected: `localStorage` —
  scroll positions are session-scoped by nature.)

## Alternatives rejected
- **`{ el }` in the custom `scrollBehavior` return** — deferred (above).
- **Anchors unsupported in hash mode** — rejected (above); the double-hash
  convention is the useful half of an inherent limitation.
- **Unbounded persisted map** — a long session would grow storage forever; 50
  entries covers any plausible back/forward depth.

## Consequences
Router-only; no compiler or runtime-kernel change; no new config. The §2 surface
is untouched (first amendment since v1.5/v1.6 to leave it alone). `to.path` was
already documented as the raw pushed path — anchors now visibly ride in it.
Non-breaking: paths without `#` behave byte-identically; the interceptor change
only *adds* information to the pushed path.
