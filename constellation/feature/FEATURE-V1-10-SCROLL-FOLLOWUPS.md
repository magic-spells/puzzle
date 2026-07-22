---
name: "v1.10 — Anchor-target scrolling + sessionStorage scroll persistence"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D41-SCROLL-ANCHORS-PERSISTENCE
  - DECISION-D33-ROUTER-SCROLL
  - FEATURE-V1-5-SCROLL-BEHAVIOR
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
---

# v1.10 — Anchor-target scrolling + sessionStorage scroll persistence

The two items [[FEATURE-V1-5-SCROLL-BEHAVIOR]] explicitly left out, shipped together as a router-only amendment. Driven by [[DECISION-D41-SCROLL-ANCHORS-PERSISTENCE]].

## Intent

Round out [[DECISION-D33-ROUTER-SCROLL]] to parity with mature routers: navigating to `/docs#faq` should land at the element, and reload + back should restore the pre-reload position.

## Scope

**In:**
- **Anchor targets.** A `#anchor` suffix on a push target refines the default landing: `document.getElementById(anchor)`'s position, top fallback when absent (including a v1.8 skeleton whose target hasn't rendered — never re-applied). Pop's saved position beats the anchor; a custom `scrollBehavior` beats everything (`to.path` carries the anchor). Resolved as a `{ anchor }` sentinel inside the commit, after mount. The history-mode link interceptor now preserves `url.hash`; hash mode carries the anchor in-fragment (`#/docs#faq`), intercepted by the existing `#/` rule.
- **Persistence.** Every position save mirrors the in-memory map to one `sessionStorage` blob (`__puzzleScroll`); `start()` hydrates from it. Cap 50 entries, oldest evicted; all storage access fail-soft; `scrollBehavior: false` touches no storage. Works because `__puzzleScrollKey` rides in `history.state`, which survives reloads.

**Out (rejected in D41):** an `{ el }` return shape for custom `scrollBehavior` fns; smooth-scroll options; scroll retention inside non-window containers.

## Outcome

Shipped in v1.10; documented in [[DOC-SPEC]] §14 and [[DOC-ROUTER]]. Router-only — touched [[COMPONENT-ROUTER]] plus `tests/router-scroll.test.js` (13 new tests); no compiler or runtime-kernel change, no new config.
