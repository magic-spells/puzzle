---
name: D41 — Anchor-target scrolling + sessionStorage scroll persistence
status: verified
verified_at: '2026-08-24T18:49:19.449Z'
connections:
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D34-HASH-ROUTING
  - DECISION-D39-SKELETON
code_refs:
  - client-runtime/router/router.js
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# D41 — Anchor-target scrolling + sessionStorage scroll persistence

Refines [[DECISION-D33-ROUTER-SCROLL]]; no new config (`scrollBehavior: false` still disables everything, a custom function still wins). See [[DOC-SPEC-ROUTER]] §14.

## Decision
- **Anchors resolve at commit.** On a **push** whose path carries `#anchor`, the default landing is `document.getElementById(decodeURIComponent(anchor))`, else top. On a **pop**, a saved position wins over the anchor. Resolution happens in `#commitState` after mount — an element position cannot exist earlier. A custom `scrollBehavior` sees the anchor in `to.path`.
- **Skeleton views resolve against whatever committed.** The anchor target is usually absent from the skeleton ([[DECISION-D39-SKELETON]]), so the landing falls back to top; waiting for `loaded` would bring back the late jump D33 avoids.
- **The path-mode link interceptor keeps the fragment** (`pathname + search + hash`). A bare `#anchor` href is left to the browser.
- **A same-document fragment pop settles in place.** Browsers route bare-anchor clicks and back/forward across `/docs` ⇄ `/docs#faq` through `popstate`. Path mode compares the popped path to the committed one ignoring the fragment; on a match nothing loads, refreshes, moves focus or announces. The URL parts of `#state` are updated in place so `current.path`/`current.hash` match the address bar and `push()`'s same-navigation guard stays correct, and scroll is restored only when a position was saved (otherwise the browser's own anchor landing stands). Hash mode gets this from its "not a route fragment" rule ([[DECISION-D34-HASH-ROUTING]]).
- **Hash mode uses a double hash.** `push('/docs#faq')` writes `#/docs#faq`; the existing `#/` parse yields `/docs#faq` and matching strips at `#`. Bare `#faq` hrefs stay native. (RFC 3986 forbids `#` in a fragment; every browser tolerates it.)
- **Persistence.** The in-memory position map is the source of truth; each save mirrors it to one `sessionStorage` key, `__puzzleScroll`, and `start()` hydrates from it. Per-entry keys already ride in `history.state`, which survives reload. The map is capped at **50 entries**, oldest evicted. All storage access is try/catch-wrapped and degrades to in-memory; `scrollBehavior: false` touches no storage.

## Alternatives rejected
- A `{ el }` return shape for custom `scrollBehavior` — the default covers the use case; widening the return contract can come later.
- Re-resolving the anchor when a skeleton's real template lands — the late jump D33 avoids.
- Declaring anchors unsupported in hash mode — the double hash costs nothing.
- Per-entry storage keys (need their own eviction index), `localStorage` (positions are session-scoped), an unbounded map.
