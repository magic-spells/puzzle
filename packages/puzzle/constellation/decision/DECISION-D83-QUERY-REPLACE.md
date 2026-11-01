---
name: D83 — Router query snapshot + router.replace()
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D42-MEMORY-MODE
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D182-NAVIGATION-RESULT
  - FILE-ROUTER
  - FILE-SSG-ASSEMBLE
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D83 — Router query snapshot + `router.replace()`

The route snapshot carries parsed URL state — `pathname`, `query`, `hash` — and `router.replace(path)` is the no-history-entry sibling of `push()`. Together they make URL-backed transient UI state (filters, tabs, search, pagination) first-class. Spec: [[DOC-SPEC-ROUTER]] §44.

## Decision

- **Snapshot fields:** `pathname` (path minus query/hash), `query` (frozen, null-prototype; `URLSearchParams` decoding; one value → string, repeated keys → frozen array in source order, valueless key → `''`), `hash` (`''` or the raw leading-`#` fragment). `path` stays raw (base-free, query+hash included). Query never merges into `params`; views read `this.route.query`. Parsed once per navigation and stored on the committed state. Prerender and static snapshots carry the same fields (empty query/hash, pathname = the page path).
- **`replace(path)`** runs the same match/load/cancellation/atomic-commit pipeline as `push()`, including the same-path no-op and the commit-window deferral slot. At commit, path/hash routing calls `history.replaceState` with the same encoding, **keeping the current scroll-entry key**; memory mode overwrites `stack[index]` in place. A failed or superseded replace commits nothing (D61).
- **Replace leaves scroll alone by default** (transient state like typing a filter) unless the target carries an explicit `#anchor`; a custom D33 `scrollBehavior` still runs and may override.
- **Same-path settlement** (both resolve a `NavigationResult`, [[DECISION-D182-NAVIGATION-RESULT]]): a push/replace to the committed path with nothing in flight resolves at once. One to the path *still in flight* (a double-click) returns that navigation's own promise, so both callers settle together on commit, failure or supersession. A different path mid-flight supersedes. Guard redirects bypass the join (D87).
- Query changes on the same route re-run the params-only refresh, so `router.replace(router.current.pathname + '?q=' + …)` composes with no new machinery.

## Alternatives rejected

- **Restructure the router's internal flags into an action enum** — the D19/D42/D61 state machine is load-bearing; one `replace` flag is the whole delta.
- **Merge query into `params`** — collides with `:param` names.
- **Ember-style sticky/serialized query state** — heavyweight and implicit.
- **Writable `route.query`** — inverts the router's one-way flow.
